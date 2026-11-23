/*
 * Skill profile + Current Students on the Platform API (owner 23/11, PR A of the slice "skill
 * profile, Current Students & Decision Engine"). The rules of the demo's mock adapters
 * (mockProfile.ts, mockStudents.ts; owner decisions 21–22/11), on PostgreSQL:
 *  - a learner's profile starts from their SYNTHETIC placement result and moves with assessed
 *    evidence — on the Platform today, the quiz scores of class-course lessons (Use of English) —
 *    through the shared, pure mastery fold of @ogc/contracts (one copy of the logic);
 *  - Current Students: ONE of three care levels (ok / watch / needs support), ALWAYS with the
 *    evidence behind it, never a psychological label. Center staff (students:view, by center) and
 *    the learner's own class teacher see it; learners and guardians do not. It never acts by
 *    itself; recommendations are suggestions for people. Overdue tuition is shown to staff with
 *    billing:manage as information only and never changes the level.
 * Thresholds come from the Decision Engine's rules (a paused rule shows no evidence), as in the demo.
 * Not on the Platform: practice attempts and speaking reviews (no "no practice" / "speaking
 * returned" evidence yet).
 */
import {
  authorize,
  DEFAULT_SUPPORT_THRESHOLDS,
  seedProfile,
  skillLabel,
  supportSignals,
  updateMastery,
} from "@ogc/contracts";
import type {
  AttendanceMark,
  CareEvidence,
  CareRecommendation,
  CourseLevel,
  LearnerProfile,
  PlacementResult,
  SkillEvidence,
  StudentCard,
  SupportThresholds,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { tuitionByLearner } from "./billing.js";
import { quizEvidence, studioByLearner } from "./classCourses.js";
import { loadLedger, makeupItems, type Ledger } from "./makeup.js";

const DAY = 86_400_000;
/** Below this share of attended (present + late) marked sessions, a learner is watched. */
export const LOW_ATTENDANCE_PCT = 80;
/** Only judge attendance once this many sessions are marked. */
export const MIN_MARKED = 3;

/** The thresholds the care level uses: the Decision Engine's rules, or their defaults. */
export interface CareThresholds extends SupportThresholds {
  absenceSessions: number | null; // absent N marked sessions in a row; null = off
  makeupDueDays: number | null; // a make-up's deadline within N days; null = off
}
export const DEFAULT_CARE: CareThresholds = {
  ...DEFAULT_SUPPORT_THRESHOLDS,
  absenceSessions: 2,
  makeupDueDays: 3,
};

/** Thresholds from the organization's engine rules: an inactive rule turns its evidence off. */
export async function careThresholds(tx: TenantTx): Promise<CareThresholds> {
  const rules = await tx
    .selectFrom("engine_rule")
    .select(["kind", "enabled", "params"])
    .where("kind", "in", ["skill_low", "skill_drop", "absence_streak", "makeup_due_soon"])
    .execute();
  if (rules.length === 0) return { ...DEFAULT_CARE };
  const p = (kind: string, key: string): number | null => {
    const r = rules.find((x) => x.kind === kind);
    if (!r || !r.enabled) return null;
    const v = (r.params as Record<string, unknown>)[key];
    return typeof v === "number" ? v : null;
  };
  return {
    low: p("skill_low", "threshold"),
    drop: p("skill_drop", "drop"),
    absenceSessions: p("absence_streak", "sessions"),
    makeupDueDays: p("makeup_due_soon", "days"),
  };
}

export async function placements(
  tx: TenantTx,
  orgId: string,
): Promise<Map<string, PlacementResult>> {
  const rows = await tx.selectFrom("placement_result").selectAll().execute();
  return new Map(
    rows.map((r) => [
      r.learner_id,
      {
        learnerId: r.learner_id,
        orgId,
        cefrBand: r.cefr_band as CourseLevel,
        skillSeed: { reading: r.reading, use_of_english: r.use_of_english, speaking: r.speaking },
      },
    ]),
  );
}

/** Marks of a learner's regular, marked sessions in the given classes, oldest first. */
export function marksOf(l: Ledger, learnerId: string, classIds: readonly string[]) {
  const out: { classId: string; at: number; mark: AttendanceMark }[] = [];
  for (const s of l.sessions.values()) {
    if (s.kind !== "regular" || !classIds.includes(s.classId)) continue;
    const m = l.marks.get(`${s.id}|${learnerId}`);
    if (m) out.push({ classId: s.classId, at: s.at.getTime(), mark: m });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The longest run of absences at the end of one class's marked sessions (attendance-v1). */
export function absenceStreak(l: Ledger, learnerId: string, classIds: readonly string[]): number {
  let best = 0;
  for (const c of classIds) {
    let run = 0;
    for (const m of marksOf(l, learnerId, [c])) run = m.mark === "absent" ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export const fmtDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));

export interface Inputs {
  ledger: Ledger;
  placements: Map<string, PlacementResult>;
  evidence: Map<string, SkillEvidence[]>;
  studio: Awaited<ReturnType<typeof studioByLearner>>;
  centers: Map<string, string>;
}

function cardFor(
  x: Inputs,
  learnerId: string,
  own: string[],
  tuition: { balanceVnd: number; overdueVnd: number } | null,
  staff: boolean,
  t: CareThresholds,
  now: number,
): StudentCard {
  const l = x.ledger;
  const evidence: CareEvidence[] = [];
  const recs: CareRecommendation[] = [];
  const rec = (r: CareRecommendation) => {
    if (!recs.some((y) => y.kind === r.kind)) recs.push(r);
  };

  // Learning: the shared support signals over placement + class-course quiz evidence.
  const placement = x.placements.get(learnerId);
  if (placement)
    for (const s of supportSignals(seedProfile(placement), x.evidence.get(learnerId) ?? [], 0, t)) {
      const skill = s.skill ? skillLabel(s.skill) : "";
      if (s.kind === "skill_drop") {
        evidence.push({
          level: "support",
          kind: "skill_drop",
          text: `${skill} dropped ${Math.abs(s.delta ?? 0)} to ${s.level} after the latest class-course quiz`,
        });
        rec({ kind: "skill_drop", text: `Review ${skill} in class with the learner`, link: null });
      } else if (s.kind === "low_skill") {
        const from = s.source === "placement" ? "placement test only" : "from class-course quizzes";
        evidence.push({
          level: "watch",
          kind: "skill_low",
          text: `${skill} is ${s.level}, below ${s.threshold} (${from})`,
        });
        rec({
          kind: "skill_low",
          text: `Give ${skill} extra attention${s.source === "placement" ? " — the level is from the placement test only" : ""}`,
          link: null,
        });
      }
    }

  // Attendance over all marked regular sessions of the learner's own classes.
  const marks = marksOf(l, learnerId, own).map((m) => m.mark);
  const streak = absenceStreak(l, learnerId, own);
  if (t.absenceSessions !== null && streak >= t.absenceSessions) {
    evidence.push({
      level: "support",
      kind: "absence_streak",
      text: `Absent from the last ${streak} marked sessions (attendance)`,
    });
    rec({
      kind: "absence_streak",
      text: "Talk with the learner about the missed sessions and arrange the make-ups",
      link: staff ? "/makeups" : null,
    });
  }
  const present = marks.filter((m) => m === "present").length;
  const late = marks.filter((m) => m === "late").length;
  const absent = marks.filter((m) => m === "absent").length;
  const pct = marks.length ? Math.round(((present + late) / marks.length) * 1000) / 10 : null;
  if (pct !== null && marks.length >= MIN_MARKED && pct < LOW_ATTENDANCE_PCT)
    evidence.push({
      level: "watch",
      kind: "low_attendance",
      text: `Attended ${present + late} of ${marks.length} marked sessions (${pct}%, below ${LOW_ATTENDANCE_PCT}%)`,
    });

  // Make-ups (from attendance; overdue = past the 14-day deadline).
  const items = makeupItems(l, now).filter((i) => i.learnerId === learnerId && i.status !== "done");
  for (const i of items) {
    const left = Math.ceil((Date.parse(i.dueAt) - now) / DAY);
    if (i.overdue)
      evidence.push({
        level: "support",
        kind: "makeup_overdue",
        text: `${i.unitTitle} not made up; deadline ${fmtDate(i.dueAt)} has passed`,
      });
    else if (t.makeupDueDays !== null && left <= t.makeupDueDays)
      evidence.push({
        level: "watch",
        kind: "makeup_due",
        text: `${i.unitTitle} not made up; ${left} day${left === 1 ? "" : "s"} left`,
      });
  }
  if (items.length)
    rec({
      kind: items.some((i) => i.overdue) ? "makeup_overdue" : "makeup_due",
      text: "Arrange the make-up (join another class, a make-up session or self-study)",
      link: staff ? "/makeups" : null,
    });

  const level = evidence.some((e) => e.level === "support")
    ? "support"
    : evidence.length
      ? "watch"
      : "ok";
  const order = { support: 0, watch: 1 } as const;
  const studio = x.studio.get(learnerId) ?? null;
  return {
    learnerId,
    name: l.learners.get(learnerId)?.name ?? "Learner",
    classes: own.map((id) => {
      const c = l.classes.get(id)!;
      return {
        id,
        name: c.name,
        centerId: c.centerId,
        centerName: x.centers.get(c.centerId) ?? "",
        teacherName: c.teacherId ? (l.teachers.get(c.teacherId) ?? null) : null,
      };
    }),
    attendance: { present, late, absent, marked: marks.length, pct, recent: marks.slice(-6) },
    // The Platform has no catalog progress: the class course's completion stands in for it.
    progressPct:
      studio && studio.totalLessons
        ? Math.round((studio.completedLessons / studio.totalLessons) * 100)
        : 0,
    lastPracticeAt: null,
    makeups: { open: items.length, overdue: items.filter((i) => i.overdue).length },
    tuition,
    studio,
    care: { level, evidence: evidence.sort((a, b) => order[a.level] - order[b.level]) },
    recommendations: recs,
  };
}

export async function loadInputs(tx: TenantTx, orgId: string): Promise<Inputs> {
  const [ledger, pl, evidence, studio, centers] = await Promise.all([
    loadLedger(tx),
    placements(tx, orgId),
    quizEvidence(tx),
    studioByLearner(tx),
    tx.selectFrom("center").select(["id", "name"]).execute(),
  ]);
  return {
    ledger,
    placements: pl,
    evidence,
    studio,
    centers: new Map(centers.map((c) => [c.id, c.name])),
  };
}

export function registerStudents(app: Api): void {
  const may = (c: Caller, action: "students:view" | "billing:manage", centerId: string) =>
    authorize(c.ctx, action, { orgId: c.ctx.orgId, centerId }).allow;

  app.secured("GET", "/v1/students", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      const staff = caller.ctx.role === "staff";
      let teacherId: string | null = null;
      if (!staff && caller.ctx.role === "teacher")
        teacherId =
          (
            await tx
              .selectFrom("teacher")
              .select("id")
              .where("principal_id", "=", caller.ctx.principalId)
              .executeTakeFirst()
          )?.id ?? null;
      if (!staff && !teacherId) return reply.code(403).send({ error: "not_allowed" });
      const now = caller.now();
      const x = await loadInputs(tx, caller.ctx.orgId);
      const visible = [...x.ledger.classes.entries()]
        .filter(
          ([, c]) =>
            may(caller, "students:view", c.centerId) && (staff || c.teacherId === teacherId),
        )
        .sort((a, z) => a[1].name.localeCompare(z[1].name));
      const byLearner = new Map<string, string[]>();
      for (const [classId] of visible)
        for (const key of x.ledger.roster) {
          const [c, learnerId] = key.split("|");
          if (c === classId) byLearner.set(learnerId, [...(byLearner.get(learnerId) ?? []), c]);
        }
      const tuition = staff ? await tuitionByLearner(tx, now) : null;
      const care = await careThresholds(tx);
      const order = { support: 0, watch: 1, ok: 2 } as const;
      return [...byLearner.entries()]
        .map(([learnerId, own]) =>
          cardFor(
            x,
            learnerId,
            own,
            tuition &&
              own.some((c) => may(caller, "billing:manage", x.ledger.classes.get(c)!.centerId))
              ? (tuition.get(learnerId) ?? { balanceVnd: 0, overdueVnd: 0 })
              : null,
            staff,
            care,
            now,
          ),
        )
        .sort((a, b) => order[a.care.level] - order[b.care.level] || a.name.localeCompare(b.name));
    }),
  );

  // A learner's own skill profile: the placement seed with their assessed evidence folded in.
  app.secured("GET", "/v1/me/skills", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      if (caller.ctx.role !== "learner") return reply.code(403).send({ error: "not_a_learner" });
      const me = await tx
        .selectFrom("learner")
        .select("id")
        .where("principal_id", "=", caller.ctx.principalId)
        .executeTakeFirst();
      const placement = me ? (await placements(tx, caller.ctx.orgId)).get(me.id) : undefined;
      if (!me || !placement) return reply.code(404).send({ error: "no_placement" });
      const profile: LearnerProfile = updateMastery(
        seedProfile(placement),
        (await quizEvidence(tx)).get(me.id) ?? [],
      );
      return profile;
    }),
  );
}
