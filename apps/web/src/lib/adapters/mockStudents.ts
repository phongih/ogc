/*
 * Current Students — MOCK adapter (SYNTHETIC). Owner decision 22/11: three care levels (ok /
 * watch / needs support), always with the evidence behind them; no psychological labels; staff
 * (within their policy's centers) and the learner's own class teacher see it — learners and
 * guardians do not. It reads the same signals as the support queue and the Decision Engine
 * (thresholds from the engine's rules), attendance marks and make-ups; it never acts by itself.
 * Overdue tuition is information for staff only and never changes the care level.
 */
import type {
  AttendanceMark,
  CareEvidence,
  CareRecommendation,
  IiosGrantedContext,
  StudentCard,
  StudentsPort,
} from "@ogc/contracts";
import { centers } from "../../fixtures/directory";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { teacherName } from "../../fixtures/personas";
import { formatCenterDate } from "../centerTime";
import { attendanceHistoryFor } from "./mockAttendance";
import { makeupItems } from "./mockMakeup";
import { learnerSignals } from "./mockProfile";
import { learningStore } from "./store";
import { activeRule } from "./engineRules";
import { allows, centerScope, inScope } from "./accessPolicy";
import { staffOrgOf, teacherIdOf } from "./viewer";
import { skillLabel } from "../../features/learning/intelligence/skills";
import { listInvoicesOfLearner } from "./mockBilling";
import { withFault } from "./faults";
import { studioOfLearner } from "./mockStudioLinks";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
const DAY = 86_400_000;

/** Below this share of attended (present + late) marked sessions, a learner is watched. */
export const LOW_ATTENDANCE_PCT = 80;
/** Only judge attendance once this many sessions are marked. */
export const MIN_MARKED = 3;
/** No practice for this many days → watch (independent of the engine's optional rule). */
export const NO_PRACTICE_DAYS = 14;

function cardFor(
  learnerId: string,
  name: string,
  orgId: string,
  own: typeof classes,
  withTuition: boolean,
  now: number,
): StudentCard {
  const evidence: CareEvidence[] = [];
  const recs: CareRecommendation[] = [];
  const rec = (r: CareRecommendation) => {
    if (!recs.some((x) => x.kind === r.kind)) recs.push(r);
  };
  const firstClass = own[0];

  // Learning + absence signals — the same ones as the support queue / engine, same thresholds.
  for (const s of learnerSignals(
    learnerId,
    orgId,
    own.map((c) => c.id),
    "engine",
  )) {
    const skill = s.skill ? skillLabel(s.skill) : "";
    const from = s.source === "placement" ? "placement test only" : "from practice";
    if (s.kind === "absences") {
      evidence.push({
        level: "support",
        kind: "absence_streak",
        text: `Absent from the last ${s.sessions} marked sessions (attendance)`,
      });
      rec({
        kind: "absence_streak",
        text: "Talk with the learner about the missed sessions and arrange the make-ups",
        link: "/app/operations",
      });
    } else if (s.kind === "skill_drop") {
      evidence.push({
        level: "support",
        kind: "skill_drop",
        text: `${skill} dropped ${Math.abs(s.delta ?? 0)} to ${s.level} after the latest practice`,
      });
      rec({
        kind: "skill_drop",
        text: `Assign a short ${skill} practice and review it in class`,
        link: firstClass ? `/app/teaching/classes/${firstClass.id}` : null,
      });
    } else if (s.kind === "low_skill") {
      evidence.push({
        level: "watch",
        kind: "skill_low",
        text: `${skill} is ${s.level}, below ${s.threshold} (${from})`,
      });
      rec({
        kind: "skill_low",
        text: `Suggest ${skill} practice${s.source === "placement" ? " — the level is from the placement test only" : ""}`,
        link: firstClass ? `/app/teaching/classes/${firstClass.id}` : null,
      });
    } else if (s.kind === "speaking_returned") {
      evidence.push({
        level: "watch",
        kind: "speaking_returned",
        text: "A speaking rehearsal was returned by the teacher for another try",
      });
      rec({
        kind: "speaking_returned",
        text: "Follow up on the returned speaking rehearsal",
        link: null,
      });
    }
  }

  // Attendance over all marked regular sessions of the learner's own classes.
  const marks: AttendanceMark[] = own.flatMap((c) => attendanceHistoryFor(c.id, learnerId));
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
  const items = makeupItems(orgId, now).filter(
    (i) => i.learnerId === learnerId && i.status !== "done",
  );
  const due = activeRule(orgId, "makeup_due_soon");
  for (const i of items) {
    const left = Math.ceil((Date.parse(i.dueAt) - now) / DAY);
    if (i.overdue)
      evidence.push({
        level: "support",
        kind: "makeup_overdue",
        text: `${i.unitTitle} not made up; deadline ${formatCenterDate(i.dueAt)} has passed`,
      });
    else if (due && left <= due.params.days)
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
      link: "/app/operations",
    });

  // Practice.
  const last = learningStore.lastEvidenceAt(learnerId);
  const quiet = last ? Math.floor((now - Date.parse(last)) / DAY) : null;
  if (quiet !== null && quiet >= NO_PRACTICE_DAYS) {
    evidence.push({
      level: "watch",
      kind: "no_practice",
      text: `No practice for ${quiet} days (last ${formatCenterDate(last!)})`,
    });
    rec({
      kind: "no_practice",
      text: "Encourage a short practice before the next class",
      link: null,
    });
  }

  const level = evidence.some((e) => e.level === "support")
    ? "support"
    : evidence.length
      ? "watch"
      : "ok";
  const order = { support: 0, watch: 1 } as const;
  const invoices = withTuition ? listInvoicesOfLearner(orgId, learnerId, now) : null;
  return {
    learnerId,
    name,
    classes: own.map((c) => ({
      id: c.id,
      name: c.name,
      centerId: c.centerId,
      centerName: centers.find((x) => x.id === c.centerId)?.name ?? "",
      teacherName: classTeachers[c.id] ? (teacherName(classTeachers[c.id]) ?? null) : null,
    })),
    attendance: { present, late, absent, marked: marks.length, pct, recent: marks.slice(-6) },
    progressPct: Math.max(
      0,
      ...own.map(
        (c) => (rosters[c.id] ?? []).find((r) => r.learnerId === learnerId)?.progressPct ?? 0,
      ),
    ),
    lastPracticeAt: last,
    makeups: { open: items.length, overdue: items.filter((i) => i.overdue).length },
    studio: studioOfLearner(
      learnerId,
      own.map((c) => c.id),
      now,
    ),
    tuition: invoices
      ? {
          balanceVnd: invoices.reduce((t, i) => t + i.balanceVnd, 0),
          overdueVnd: invoices
            .filter((i) => i.daysOverdue > 0)
            .reduce((t, i) => t + i.balanceVnd, 0),
        }
      : null,
    care: { level, evidence: evidence.sort((a, b) => order[a.level] - order[b.level]) },
    recommendations: recs,
  };
}

export const mockStudents: StudentsPort = {
  list: (viewer: IiosGrantedContext) =>
    withFault("students.list", () => {
      const now = Date.now();
      const staffOrg = staffOrgOf(viewer);
      const teacher = teacherIdOf(viewer);
      if (!staffOrg && !teacher) return latency<StudentCard[] | null>(null);
      const org = viewer.orgId;
      const scope = centerScope(viewer, "students:view");
      const visible = classes.filter(
        (c) =>
          c.orgId === org &&
          inScope(scope, c.centerId) &&
          (staffOrg ? true : classTeachers[c.id] === teacher),
      );
      const byLearner = new Map<string, { name: string; own: typeof classes }>();
      for (const c of visible)
        for (const r of rosters[c.id] ?? []) {
          const e = byLearner.get(r.learnerId) ?? { name: r.displayName, own: [] };
          e.own.push(c);
          byLearner.set(r.learnerId, e);
        }
      const order = { support: 0, watch: 1, ok: 2 } as const;
      return latency(
        [...byLearner.entries()]
          .map(([id, e]) =>
            cardFor(
              id,
              e.name,
              org,
              e.own,
              !!staffOrg &&
                e.own.some((c) => allows(viewer, "billing:manage", { centerId: c.centerId })),
              now,
            ),
          )
          .sort(
            (a, b) => order[a.care.level] - order[b.care.level] || a.name.localeCompare(b.name),
          ),
      );
    }),
};
