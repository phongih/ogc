/*
 * Class courses + My Learning on the Platform API (owner 23/11, slice 3 part B). The rules of the
 * demo's mock adapters (mockStudioLinks.ts, courseProgress.ts, mockClassCoursePlayer.ts; owner
 * decisions 22/11), on PostgreSQL:
 *  - a class follows one OGC course with a published version: the class teacher PROPOSES it,
 *    center staff (courses:link, by center) LINK it (with weekly prep hours, 0–10 in half hours,
 *    counted for the class teacher in Workforce) — or reject / unlink it with a reason;
 *  - completion comes from the learners' own progress: lessons completed of the version each
 *    learner is on, and the last activity;
 *  - a learner of the class takes the course in My Learning, PINNED to the version of their first
 *    completed lesson; quiz answers stay hidden until the lesson is completed; every question and
 *    every reflection must be answered; a completed lesson is final and keeps its quiz score.
 * Speaking rehearsals (owner 23/11): completing a lesson submits each one; it counts for Speaking
 * only once the learner's class teacher approves it, or the teacher returns it with a note and the
 * learner tries again. Center staff see the queue, never decide. SYNTHETIC content only.
 */
import { sql } from "kysely";
import {
  AUTHORING_LIMITS,
  authorize,
  hideLessonAnswers,
  isPracticeBlock,
  lessonPracticeScore,
  lessonQuizScore,
  normalizeLesson,
  practiceChoices,
  speakingScore,
} from "@ogc/contracts";
import type {
  BlockOf,
  ClassCourseLink,
  CourseSpeakingReviewItem,
  MissionAttemptView,
  MissionReviewItem,
  MissionReviewQueue,
  CourseVersion,
  LearnerStudioProgress,
  LinkStatus,
  MyClassCourse,
  MyLessonView,
  SkillEvidence,
  SpeakingAttemptView,
  SpeakingReviewQueue,
  StudioCourse,
  StudioOverview,
  StudioRefusal,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { latest, load as loadCourses, statusOf, type Stored } from "./courses.js";

export const MAX_PREP_HOURS = 10;
const DAY = 86_400_000;

type Result = { ok: true } | { ok: false; reason: StudioRefusal; detail?: string };
const no = (reason: StudioRefusal, detail?: string): Result => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});
const STATUS: Record<StudioRefusal, number> = {
  not_allowed: 403,
  access_policy: 403,
  not_found: 404,
  invalid: 422,
  invalid_step: 409,
};

interface Link {
  id: string;
  classId: string;
  courseRef: string;
  status: LinkStatus;
  prepHours: number;
  proposedBy: string | null;
  proposedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}
interface Done {
  at: string;
  score: number | null;
  answers: Record<string, number>;
  reflections: Record<string, string>;
  speaking: Record<string, number[]>;
  practice: Record<string, number[]>; // stored with the quiz answers (arrays); XP only
}
interface Book {
  classes: Map<string, { name: string; centerId: string; teacherId: string | null }>;
  centers: Map<string, string>;
  teachers: Map<string, string>;
  roster: Map<string, { learnerId: string; name: string }[]>;
  links: Link[];
  courses: Map<string, Stored>;
  pins: Map<string, number>; // `${learnerId}|${ref}` → pinned version
  done: Map<string, Map<string, Done>>; // `${learnerId}|${ref}` → lessonId → done
}
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const k = (learnerId: string, ref: string) => `${learnerId}|${ref}`;

async function loadBook(tx: TenantTx): Promise<Book> {
  const [classes, centers, teachers, roster, links, courses, pins, done] = await Promise.all([
    tx.selectFrom("class").select(["id", "name", "center_id", "teacher_id"]).execute(),
    tx.selectFrom("center").select(["id", "name"]).execute(),
    tx.selectFrom("teacher").select(["id", "name"]).execute(),
    tx
      .selectFrom("roster as r")
      .innerJoin("learner as l", "l.id", "r.learner_id")
      .select(["r.class_id", "r.learner_id", "l.display_name"])
      .orderBy("l.display_name")
      .execute(),
    tx.selectFrom("class_course_link").selectAll().execute(),
    loadCourses(tx),
    tx.selectFrom("course_progress").select(["learner_id", "course_ref", "version"]).execute(),
    tx.selectFrom("course_lesson_done").selectAll().execute(),
  ]);
  const rosterMap = new Map<string, { learnerId: string; name: string }[]>();
  for (const r of roster)
    rosterMap.set(r.class_id, [
      ...(rosterMap.get(r.class_id) ?? []),
      { learnerId: r.learner_id, name: r.display_name },
    ]);
  const doneMap = new Map<string, Map<string, Done>>();
  for (const d of done) {
    const m = doneMap.get(k(d.learner_id, d.course_ref)) ?? new Map<string, Done>();
    const answers: Record<string, number> = {};
    const practice: Record<string, number[]> = {};
    for (const [id, a] of Object.entries((d.answers ?? {}) as Record<string, unknown>))
      if (Array.isArray(a)) practice[id] = a as number[];
      else answers[id] = a as number;
    m.set(d.lesson_id, {
      at: d.at.toISOString(),
      score: d.score,
      answers,
      practice,
      reflections: d.reflections as Record<string, string>,
      speaking: (d.speaking ?? {}) as Record<string, number[]>,
    });
    doneMap.set(k(d.learner_id, d.course_ref), m);
  }
  return {
    classes: new Map(
      classes.map((c) => [c.id, { name: c.name, centerId: c.center_id, teacherId: c.teacher_id }]),
    ),
    centers: new Map(centers.map((c) => [c.id, c.name])),
    teachers: new Map(teachers.map((t) => [t.id, t.name])),
    roster: rosterMap,
    links: links.map((l) => ({
      id: l.id,
      classId: l.class_id,
      courseRef: l.course_ref,
      status: l.status,
      prepHours: Number(l.prep_hours),
      proposedBy: l.proposed_by,
      proposedAt: iso(l.proposed_at),
      decidedBy: l.decided_by,
      decidedAt: iso(l.decided_at),
      reason: l.reason,
    })),
    courses: new Map(courses.map((c) => [c.ref, c])),
    pins: new Map(pins.map((p) => [k(p.learner_id, p.course_ref), p.version])),
    done: doneMap,
  };
}

// ── shared rules (the demo's) ───────────────────────────────────────────────────────────────
function courseView(c: Stored): StudioCourse {
  const last = latest(c);
  return {
    ref: c.ref,
    title: last?.content.title ?? c.draft.title,
    lessons: last?.content.lessons.length ?? 0,
    version: last?.version ?? null,
    status: statusOf(c),
    updatedAt: c.updatedAt,
    linkable: !!last,
  };
}
const activeLinkOf = (b: Book, classId: string) =>
  b.links.find((l) => l.classId === classId && l.status === "linked") ?? null;

/** The version a learner sees: their pin, else the latest published one. */
function versionFor(b: Book, ref: string, learnerId: string): CourseVersion | null {
  const c = b.courses.get(ref);
  if (!c) return null;
  const pin = b.pins.get(k(learnerId, ref));
  return (pin !== undefined ? c.versions.find((v) => v.version === pin) : null) ?? latest(c);
}
function completionOf(b: Book, ref: string, learnerId: string) {
  const v = versionFor(b, ref, learnerId);
  if (!v) return null;
  const d = b.done.get(k(learnerId, ref));
  const done = v.content.lessons.filter((l) => d?.has(l.id));
  const last =
    done
      .map((l) => d!.get(l.id)!.at)
      .sort()
      .pop() ?? null;
  return {
    version: v.version,
    title: v.content.title,
    completedLessons: done.length,
    totalLessons: v.content.lessons.length,
    lastActivityAt: last,
  };
}

/** Weekly prep hours of linked courses, per class teacher (Workforce). */
export async function prepHoursByTeacher(
  tx: TenantTx,
): Promise<Map<string, { classId: string; className: string; hours: number }[]>> {
  const rows = await tx
    .selectFrom("class_course_link as l")
    .innerJoin("class as c", "c.id", "l.class_id")
    .select(["l.class_id", "c.name", "c.teacher_id", "l.prep_hours"])
    .where("l.status", "=", "linked")
    .where("l.prep_hours", ">", 0)
    .execute();
  const out = new Map<string, { classId: string; className: string; hours: number }[]>();
  for (const r of rows)
    if (r.teacher_id)
      out.set(r.teacher_id, [
        ...(out.get(r.teacher_id) ?? []),
        { classId: r.class_id, className: r.name, hours: Number(r.prep_hours) },
      ]);
  return out;
}

/** Current Students: completion of each learner in the course linked to one of their classes. */
export async function studioByLearner(
  tx: TenantTx,
): Promise<
  Map<
    string,
    { title: string; completedLessons: number; totalLessons: number; lastActivityAt: string | null }
  >
> {
  const b = await loadBook(tx);
  const out = new Map<
    string,
    { title: string; completedLessons: number; totalLessons: number; lastActivityAt: string | null }
  >();
  const classes = [...b.classes.entries()].sort((a, z) => a[1].name.localeCompare(z[1].name));
  for (const [id] of classes) {
    const l = activeLinkOf(b, id);
    if (!l) continue;
    for (const r of b.roster.get(id) ?? []) {
      if (out.has(r.learnerId)) continue;
      const p = completionOf(b, l.courseRef, r.learnerId);
      if (p)
        out.set(r.learnerId, {
          title: p.title,
          completedLessons: p.completedLessons,
          totalLessons: p.totalLessons,
          lastActivityAt: p.lastActivityAt,
        });
    }
  }
  return out;
}

/** Decision Engine: learners of linked classes with no lesson completed for `days` (completion only). */
export async function studioInactive(tx: TenantTx, days: number, now: number) {
  const b = await loadBook(tx);
  const out: {
    learnerId: string;
    name: string;
    classId: string;
    className: string;
    teacherId: string | null;
    course: string;
    since: string;
  }[] = [];
  for (const l of b.links) {
    if (l.status !== "linked") continue;
    const linkedAt = Date.parse(l.decidedAt ?? "");
    if (!Number.isFinite(linkedAt) || now - linkedAt < days * DAY) continue; // give a new link time
    const cls = b.classes.get(l.classId);
    for (const r of b.roster.get(l.classId) ?? []) {
      const p = completionOf(b, l.courseRef, r.learnerId);
      if (!p) continue;
      const last = p.lastActivityAt ? Math.max(Date.parse(p.lastActivityAt), linkedAt) : linkedAt;
      if (p.completedLessons < p.totalLessons && now - last >= days * DAY)
        out.push({
          learnerId: r.learnerId,
          name: r.name,
          classId: l.classId,
          className: cls?.name ?? "a class",
          teacherId: cls?.teacherId ?? null,
          course: p.title,
          since: new Date(last).toISOString(),
        });
    }
  }
  return out;
}

/** Skill profile: each completed class-course lesson with a quiz is one piece of Use of English evidence. */
export async function quizEvidence(tx: TenantTx): Promise<Map<string, SkillEvidence[]>> {
  const rows = await tx
    .selectFrom("course_lesson_done as d")
    .innerJoin("course_progress as p", (j) =>
      j.onRef("p.learner_id", "=", "d.learner_id").onRef("p.course_ref", "=", "d.course_ref"),
    )
    .select(["d.learner_id", "d.course_ref", "d.lesson_id", "d.at", "d.score", "p.version"])
    .where("d.score", "is not", null)
    .execute();
  const out = new Map<string, SkillEvidence[]>();
  for (const r of rows)
    out.set(r.learner_id, [
      ...(out.get(r.learner_id) ?? []),
      {
        attemptId: `CS:${r.course_ref}:v${r.version}:${r.lesson_id}`,
        skill: "use_of_english",
        score: r.score!,
        at: r.at.toISOString(),
      },
    ]);
  return out;
}

// ── speaking rehearsals (owner 23/11, slice 5) ──────────────────────────────────────────────
type AttemptRow = {
  learner_id: string;
  course_ref: string;
  lesson_id: string;
  block_id: string;
  attempt: number;
  choices: unknown;
  score: number;
  submitted_at: Date;
  status: "pending" | "approved" | "returned";
  reviewed_at: Date | null;
  reviewed_by: string | null;
  note: string | null;
};
const attemptView = (r: AttemptRow): SpeakingAttemptView => ({
  blockId: r.block_id,
  attempt: r.attempt,
  choices: r.choices as number[],
  score: r.score,
  status: r.status,
  submittedAt: r.submitted_at.toISOString(),
  reviewedAt: iso(r.reviewed_at),
  reviewerName: r.reviewed_by,
  note: r.note,
});
/** The latest attempt of each speaking block (learner, course, lesson, block). */
async function latestAttempts(tx: TenantTx, learnerId?: string): Promise<AttemptRow[]> {
  let q = tx.selectFrom("course_speaking_attempt").selectAll();
  if (learnerId) q = q.where("learner_id", "=", learnerId);
  const rows = (await q.orderBy("attempt", "desc").execute()) as AttemptRow[];
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = [r.learner_id, r.course_ref, r.lesson_id, r.block_id].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Skill profile: a speaking rehearsal counts for Speaking only once the class teacher approves it. */
export async function speakingEvidence(tx: TenantTx): Promise<Map<string, SkillEvidence[]>> {
  const rows = await tx
    .selectFrom("course_speaking_attempt")
    .select([
      "learner_id",
      "course_ref",
      "lesson_id",
      "block_id",
      "attempt",
      "score",
      "reviewed_at",
    ])
    .where("status", "=", "approved")
    .execute();
  const out = new Map<string, SkillEvidence[]>();
  for (const r of rows)
    out.set(r.learner_id, [
      ...(out.get(r.learner_id) ?? []),
      {
        attemptId: `SP:${r.course_ref}:${r.lesson_id}:${r.block_id}:${r.attempt}`,
        skill: "speaking",
        score: r.score,
        at: r.reviewed_at!.toISOString(),
      },
    ]);
  return out;
}

/** Rehearsals whose latest attempt the class teacher returned, per learner (support signal). */
export async function speakingReturned(tx: TenantTx): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await latestAttempts(tx))
    if (r.status === "returned") out.set(r.learner_id, (out.get(r.learner_id) ?? 0) + 1);
  return out;
}

// ── Mission Box (owner 24/11): the class teacher reviews; XP only, never skill evidence ─────
type MissionRow = {
  learner_id: string;
  course_ref: string;
  lesson_id: string;
  block_id: string;
  attempt: number;
  note: string;
  submitted_at: Date;
  status: "pending" | "approved" | "returned";
  reviewed_at: Date | null;
  reviewed_by: string | null;
  review_note: string | null;
};
const missionView = (r: MissionRow): MissionAttemptView => ({
  blockId: r.block_id,
  attempt: r.attempt,
  note: r.note,
  status: r.status,
  submittedAt: r.submitted_at.toISOString(),
  reviewedAt: iso(r.reviewed_at),
  reviewerName: r.reviewed_by,
  reviewNote: r.review_note,
});
/** The latest attempt of each mission (learner, course, lesson, block). */
async function latestMissions(tx: TenantTx, learnerId?: string): Promise<MissionRow[]> {
  let q = tx.selectFrom("course_mission_attempt").selectAll();
  if (learnerId) q = q.where("learner_id", "=", learnerId);
  const rows = (await q.orderBy("attempt", "desc").execute()) as MissionRow[];
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = [r.learner_id, r.course_ref, r.lesson_id, r.block_id].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** A learner's note on a mission: a string, trimmed, at most 300 characters ('' allowed). */
const missionNote = (raw: unknown): string | null =>
  typeof raw === "string" && raw.trim().length <= AUTHORING_LIMITS.missionNote ? raw.trim() : null;

/** The replies chosen in a speaking block: one valid option per turn. */
function speakingChoices(b: BlockOf<"speaking">, raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== b.turns.length) return null;
  for (let i = 0; i < raw.length; i++) {
    const x: unknown = raw[i];
    if (!Number.isInteger(x) || (x as number) < 0 || (x as number) >= b.turns[i].options.length)
      return null;
  }
  return raw as number[];
}

interface Who {
  staff: boolean;
  teacherId: string | null;
  name: string;
}
async function whoAmI(tx: TenantTx, caller: Caller): Promise<Who> {
  const { ctx } = caller;
  if (ctx.role === "staff") {
    const s = await tx
      .selectFrom("staff_member")
      .select("display_name")
      .where("principal_id", "=", ctx.principalId)
      .executeTakeFirst();
    return { staff: true, teacherId: null, name: s?.display_name ?? ctx.principalId };
  }
  if (ctx.role === "teacher") {
    const t = await tx
      .selectFrom("teacher")
      .select(["id", "name"])
      .where("principal_id", "=", ctx.principalId)
      .executeTakeFirst();
    return { staff: false, teacherId: t?.id ?? null, name: t?.name ?? ctx.principalId };
  }
  return { staff: false, teacherId: null, name: ctx.principalId };
}

export function registerClassCourses(app: Api): void {
  const mayLink = (c: Caller, centerId: string) =>
    c.ctx.role === "staff" &&
    authorize(c.ctx, "courses:link", { orgId: c.ctx.orgId, centerId }).allow;

  /** Classes the caller sees: staff within their courses:link centers, a teacher their own. */
  const visible = (b: Book, c: Caller, who: Who) => {
    if (who.staff) {
      const list = [...b.classes.entries()].filter(([, x]) => mayLink(c, x.centerId));
      return list.length ? { role: "staff" as const, list } : null;
    }
    if (who.teacherId)
      return {
        role: "teacher" as const,
        list: [...b.classes.entries()].filter(([, x]) => x.teacherId === who.teacherId),
      };
    return null;
  };

  const view = (b: Book, c: Caller, l: Link): ClassCourseLink | null => {
    const cls = b.classes.get(l.classId);
    const course = b.courses.get(l.courseRef);
    if (!cls || !course) return null;
    return {
      id: l.id,
      classId: l.classId,
      className: cls.name,
      centerId: cls.centerId,
      centerName: b.centers.get(cls.centerId) ?? "Center",
      course: courseView(course),
      status: l.status,
      prepHoursPerWeek: l.prepHours,
      proposedBy: l.proposedBy,
      proposedAt: l.proposedAt,
      decidedBy: l.decidedBy,
      decidedAt: l.decidedAt,
      reason: l.reason,
      mineToDecide: l.status === "proposed" && mayLink(c, cls.centerId),
    };
  };

  app.secured("GET", "/v1/class-courses", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      const [b, who] = await Promise.all([loadBook(tx), whoAmI(tx, caller)]);
      const v = visible(b, caller, who);
      if (!v) return reply.code(403).send({ error: "not_allowed" });
      const ids = new Set(v.list.map(([id]) => id));
      const out: StudioOverview = {
        role: v.role,
        classes: v.list
          .map(([id, x]) => ({
            id,
            name: x.name,
            centerName: b.centers.get(x.centerId) ?? "Center",
            teacherName: x.teacherId ? (b.teachers.get(x.teacherId) ?? null) : null,
          }))
          .sort((a, z) => a.name.localeCompare(z.name)),
        links: b.links
          .filter((l) => ids.has(l.classId))
          .sort(
            (a, z) =>
              (z.decidedAt ?? z.proposedAt ?? "").localeCompare(
                a.decidedAt ?? a.proposedAt ?? "",
              ) || z.id.localeCompare(a.id),
          )
          .map((l) => view(b, caller, l))
          .filter((x): x is ClassCourseLink => x !== null),
        canLink: v.role === "staff",
      };
      return out;
    }),
  );

  app.secured("GET", "/v1/class-courses/search", async (caller, req, reply) =>
    caller.tenant(async (tx) => {
      const [b, who] = await Promise.all([loadBook(tx), whoAmI(tx, caller)]);
      if (!visible(b, caller, who)) return reply.code(403).send({ error: "not_allowed" });
      const raw = (req.query as { q?: unknown }).q;
      const q = (typeof raw === "string" ? raw : "").slice(0, 60).trim().toLowerCase();
      return [...b.courses.values()]
        .filter((c) => who.staff || !!latest(c) || c.ownerTeacherId === who.teacherId)
        .map(courseView)
        .filter((c) => !q || `${c.ref} ${c.title}`.toLowerCase().includes(q))
        .sort((a, z) => Number(z.linkable) - Number(a.linkable) || a.title.localeCompare(z.title));
    }),
  );

  app.secured("GET", "/v1/class-courses/:id/progress", async (caller, req, reply) =>
    caller.tenant(async (tx) => {
      const [b, who] = await Promise.all([loadBook(tx), whoAmI(tx, caller)]);
      const v = visible(b, caller, who);
      const l = b.links.find((x) => x.id === (req.params as { id: string }).id);
      if (!v || !l || l.status !== "linked" || !v.list.some(([id]) => id === l.classId))
        return reply.code(404).send({ error: "not_found" });
      return (b.roster.get(l.classId) ?? []).map((r): LearnerStudioProgress => {
        const p = completionOf(b, l.courseRef, r.learnerId);
        const done = p?.completedLessons ?? 0;
        const total = p?.totalLessons ?? 0;
        return {
          learnerId: r.learnerId,
          name: r.name,
          completedLessons: done,
          totalLessons: total,
          pct: total ? Math.round((done / total) * 100) : 0,
          lastActivityAt: p?.lastActivityAt ?? null,
          version: p?.version ?? null,
        };
      });
    }),
  );

  /** A write, serialised with Course Studio (same lock), audited. */
  const write = <T extends { ok: boolean; reason?: StudioRefusal }>(
    url: string,
    action: string,
    run: (
      tx: TenantTx,
      b: Book,
      who: Who,
      caller: Caller,
      body: Record<string, unknown>,
      params: Record<string, string>,
      now: Date,
    ) => Promise<T>,
  ) =>
    app.secured("POST", url, async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = req.params as Record<string, string>;
      await caller.write<T>(`POST ${url}`, { params, body }, async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtext('courses:' || ${caller.ctx.orgId}))`.execute(
          tx,
        );
        const [b, who] = await Promise.all([loadBook(tx), whoAmI(tx, caller)]);
        const r = await run(tx, b, who, caller, body, params, new Date(caller.now()));
        return {
          status: r.ok ? 200 : STATUS[r.reason!],
          body: r,
          audit: {
            action,
            resource: {
              ...params,
              ...(typeof body.classId === "string" ? { classId: body.classId } : {}),
            },
            outcome: r.ok ? ("allowed" as const) : ("denied" as const),
            ...(r.ok ? { after: { url } } : { reason: r.reason }),
          },
        };
      });
    });

  const nextId = (b: Book) =>
    `SL-${b.links.reduce((m, l) => Math.max(m, Number(l.id.slice(3)) || 0), 0) + 1}`;
  const hoursIssue = (h: unknown): string | null =>
    typeof h === "number" && Number.isFinite(h) && h >= 0 && h <= MAX_PREP_HOURS
      ? null
      : `prep hours: 0–${MAX_PREP_HOURS} per week`;
  const reasonIssue = (r: unknown): string | null => {
    const t = typeof r === "string" ? r.trim() : "";
    return t.length < 3 || t.length > 200 ? "give a reason (3–200 characters)" : null;
  };

  write("/v1/class-courses/propose", "courses:link", async (tx, b, who, _c, body, _p, now) => {
    const classId = typeof body.classId === "string" ? body.classId : "";
    const cls = b.classes.get(classId);
    if (!who.teacherId || !cls || cls.teacherId !== who.teacherId)
      return no("not_allowed", "only the class teacher proposes a course for the class");
    const c = b.courses.get(typeof body.courseRef === "string" ? body.courseRef : "");
    if (!c || !(latest(c) || c.ownerTeacherId === who.teacherId)) return no("not_found");
    if (!latest(c)) return no("invalid_step", `${c.draft.title} has no published version`);
    if (activeLinkOf(b, classId)?.courseRef === c.ref)
      return no("invalid_step", "already linked to this class");
    if (
      b.links.some((l) => l.classId === classId && l.courseRef === c.ref && l.status === "proposed")
    )
      return no("invalid_step", "already proposed");
    await tx
      .insertInto("class_course_link")
      .values({
        org_id: sql`ogc_current_org()`,
        id: nextId(b),
        class_id: classId,
        course_ref: c.ref,
        status: "proposed",
        prep_hours: 0,
        proposed_by: who.name,
        proposed_at: now,
        decided_by: null,
        decided_at: null,
        reason: null,
      } as never)
      .execute();
    return { ok: true } as Result;
  });

  write("/v1/class-courses/link", "courses:link", async (tx, b, who, caller, body, _p, now) => {
    const classId = typeof body.classId === "string" ? body.classId : "";
    const cls = b.classes.get(classId);
    if (!who.staff || !cls) return no("not_allowed", "center staff link courses");
    if (!mayLink(caller, cls.centerId)) return no("access_policy");
    const c = b.courses.get(typeof body.courseRef === "string" ? body.courseRef : "");
    if (!c) return no("not_found");
    if (!latest(c)) return no("invalid_step", `${c.draft.title} has no published version`);
    if (activeLinkOf(b, classId))
      return no("invalid_step", "the class already follows a course — unlink it first");
    const h = hoursIssue(body.prepHoursPerWeek);
    if (h) return no("invalid", h);
    const hours = Math.round((body.prepHoursPerWeek as number) * 2) / 2;
    const proposal = b.links.find(
      (l) => l.classId === classId && l.courseRef === c.ref && l.status === "proposed",
    );
    if (proposal)
      await tx
        .updateTable("class_course_link")
        .set({ status: "linked", prep_hours: hours, decided_by: who.name, decided_at: now })
        .where("id", "=", proposal.id)
        .execute();
    else
      await tx
        .insertInto("class_course_link")
        .values({
          org_id: sql`ogc_current_org()`,
          id: nextId(b),
          class_id: classId,
          course_ref: c.ref,
          status: "linked",
          prep_hours: hours,
          proposed_by: null,
          proposed_at: null,
          decided_by: who.name,
          decided_at: now,
          reason: null,
        } as never)
        .execute();
    return { ok: true } as Result;
  });

  /** reject / unlink / prep: a decision on one link by staff with courses:link at its center. */
  const decide = (
    step: string,
    run: (
      tx: TenantTx,
      l: Link,
      who: Who,
      body: Record<string, unknown>,
      now: Date,
    ) => Promise<Result>,
  ) =>
    write(
      `/v1/class-courses/:id/${step}`,
      "courses:link",
      async (tx, b, who, caller, body, p, now) => {
        const l = b.links.find((x) => x.id === p.id);
        const cls = l ? b.classes.get(l.classId) : undefined;
        if (!l || !cls) return no("not_found");
        if (!mayLink(caller, cls.centerId)) return no("access_policy");
        return run(tx, l, who, body, now);
      },
    );

  decide("reject", async (tx, l, who, body, now) => {
    if (l.status !== "proposed") return no("invalid_step", `already ${l.status}`);
    const r = reasonIssue(body.reason);
    if (r) return no("invalid", r);
    await tx
      .updateTable("class_course_link")
      .set({
        status: "rejected",
        reason: (body.reason as string).trim(),
        decided_by: who.name,
        decided_at: now,
      })
      .where("id", "=", l.id)
      .execute();
    return { ok: true };
  });

  decide("unlink", async (tx, l, who, body, now) => {
    if (l.status !== "linked") return no("invalid_step", `not linked (${l.status})`);
    const r = reasonIssue(body.reason);
    if (r) return no("invalid", r);
    await tx
      .updateTable("class_course_link")
      .set({
        status: "unlinked",
        reason: (body.reason as string).trim(),
        decided_by: who.name,
        decided_at: now,
      })
      .where("id", "=", l.id)
      .execute();
    return { ok: true };
  });

  decide("prep", async (tx, l, _who, body) => {
    if (l.status !== "linked") return no("invalid_step", "only a linked course");
    const h = hoursIssue(body.hours);
    if (h) return no("invalid", h);
    await tx
      .updateTable("class_course_link")
      .set({ prep_hours: Math.round((body.hours as number) * 2) / 2 })
      .where("id", "=", l.id)
      .execute();
    return { ok: true };
  });

  // ── My Learning (learners, self-scoped) ───────────────────────────────────────────────────
  const learnerOf = async (tx: TenantTx, c: Caller) =>
    c.ctx.role === "learner"
      ? ((
          await tx
            .selectFrom("learner")
            .select("id")
            .where("principal_id", "=", c.ctx.principalId)
            .executeTakeFirst()
        )?.id ?? null)
      : null;
  /** The class courses open to a learner: the linked course of each of their classes. */
  const openTo = (b: Book, learnerId: string) => {
    const open: { ref: string; className: string }[] = [];
    for (const [id, cls] of [...b.classes.entries()].sort((a, z) =>
      a[1].name.localeCompare(z[1].name),
    )) {
      if (!(b.roster.get(id) ?? []).some((r) => r.learnerId === learnerId)) continue;
      const l = activeLinkOf(b, id);
      if (l && !open.some((o) => o.ref === l.courseRef))
        open.push({ ref: l.courseRef, className: cls.name });
    }
    return open;
  };
  app.secured("GET", "/v1/me/class-courses", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      const learnerId = await learnerOf(tx, caller);
      if (!learnerId) return reply.code(403).send({ error: "not_a_learner" });
      const b = await loadBook(tx);
      const out: MyClassCourse[] = [];
      for (const o of openTo(b, learnerId)) {
        const c = b.courses.get(o.ref);
        const v = versionFor(b, o.ref, learnerId);
        if (!c || !v) continue;
        const d = b.done.get(k(learnerId, o.ref));
        const lessons = v.content.lessons.map((l) => ({
          lessonId: l.id,
          title: l.title,
          completedAt: d?.get(l.id)?.at ?? null,
          score: d?.get(l.id)?.score ?? null,
        }));
        const done = lessons.filter((l) => l.completedAt).length;
        out.push({
          ref: o.ref,
          className: o.className,
          title: v.content.title,
          summary: v.content.summary,
          version: v.version,
          latestVersion: latest(c)?.version ?? v.version,
          lessons,
          completedLessons: done,
          pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
        });
      }
      return out;
    }),
  );

  app.secured("GET", "/v1/me/class-courses/:ref/:lessonId", async (caller, req, reply) =>
    caller.tenant(async (tx) => {
      const { ref, lessonId } = req.params as { ref: string; lessonId: string };
      const learnerId = await learnerOf(tx, caller);
      if (!learnerId) return reply.code(403).send({ error: "not_a_learner" });
      const b = await loadBook(tx);
      if (!openTo(b, learnerId).some((o) => o.ref === ref))
        return reply.code(404).send({ error: "not_found" });
      const v = versionFor(b, ref, learnerId);
      const idx = v ? v.content.lessons.findIndex((l) => l.id === lessonId) : -1;
      if (!v || idx < 0) return reply.code(404).send({ error: "not_found" });
      const lesson = normalizeLesson(v.content.lessons[idx]);
      const done = b.done.get(k(learnerId, ref))?.get(lessonId) ?? null;
      const speaking = (await latestAttempts(tx, learnerId))
        .filter((a) => a.course_ref === ref && a.lesson_id === lessonId)
        .map(attemptView);
      const missions = (await latestMissions(tx, learnerId))
        .filter((a) => a.course_ref === ref && a.lesson_id === lessonId)
        .map(missionView);
      const out: MyLessonView = {
        ref,
        version: v.version,
        lesson: done ? lesson : hideLessonAnswers(lesson),
        index: idx,
        total: v.content.lessons.length,
        completed: done
          ? { ...done, practiceScore: lessonPracticeScore(lesson, done.practice) }
          : null,
        speaking,
        missions,
      };
      return out;
    }),
  );

  type Out =
    | { ok: true; score: number | null; practiceScore: number | null }
    | { ok: false; reason: StudioRefusal | "not_allowed"; detail?: string };
  app.secured("POST", "/v1/me/class-courses/:ref/:lessonId/complete", async (caller, req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const params = req.params as { ref: string; lessonId: string };
    await caller.write<Out>(
      "POST /v1/me/class-courses/:ref/:lessonId/complete",
      { params, body },
      async (tx) => {
        await sql`select pg_advisory_xact_lock(hashtext('courses:' || ${caller.ctx.orgId}))`.execute(
          tx,
        );
        const r = await complete(tx, caller, params, body);
        return {
          status: r.ok ? 200 : STATUS[r.reason],
          body: r,
          audit: {
            action: "courses:learn",
            resource: { ...params },
            outcome: r.ok ? ("allowed" as const) : ("denied" as const),
            ...(r.ok ? { after: { score: r.score } } : { reason: r.reason }),
          },
        };
      },
    );
  });

  // ── speaking rehearsals: try again, and the class teacher's review ─────────────────────────
  const lock = (tx: TenantTx, c: Caller) =>
    sql`select pg_advisory_xact_lock(hashtext('courses:' || ${c.ctx.orgId}))`.execute(tx);
  const rehearsalOf = (b: Book, ref: string, learnerId: string, lessonId: string, id: string) => {
    const v = versionFor(b, ref, learnerId);
    const lesson = v?.content.lessons.find((l) => l.id === lessonId);
    const block = lesson?.blocks.find((x) => x.id === id && x.kind === "speaking") as
      BlockOf<"speaking"> | undefined;
    return v && lesson && block ? { v, lesson, block } : null;
  };

  type Plain = { ok: true } | { ok: false; reason: StudioRefusal; detail?: string };
  app.secured(
    "POST",
    "/v1/me/class-courses/:ref/:lessonId/speaking/:blockId",
    async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = req.params as { ref: string; lessonId: string; blockId: string };
      await caller.write<Plain>(
        "POST /v1/me/class-courses/:ref/:lessonId/speaking/:blockId",
        { params, body },
        async (tx) => {
          await lock(tx, caller);
          const r = await retry(tx, caller, params, body);
          return {
            status: r.ok ? 200 : STATUS[r.reason],
            body: r,
            audit: {
              action: "courses:learn",
              resource: { ...params },
              outcome: r.ok ? ("allowed" as const) : ("denied" as const),
              ...(r.ok ? {} : { reason: r.reason }),
            },
          };
        },
      );
    },
  );
  async function retry(
    tx: TenantTx,
    caller: Caller,
    { ref, lessonId, blockId }: { ref: string; lessonId: string; blockId: string },
    body: Record<string, unknown>,
  ): Promise<Plain> {
    const learnerId = await learnerOf(tx, caller);
    if (!learnerId) return no("not_allowed", "learners rehearse their own lessons");
    const b = await loadBook(tx);
    if (!openTo(b, learnerId).some((o) => o.ref === ref)) return no("not_found");
    const found = rehearsalOf(b, ref, learnerId, lessonId, blockId);
    if (!found) return no("not_found");
    const last = (await latestAttempts(tx, learnerId)).find(
      (a) => a.course_ref === ref && a.lesson_id === lessonId && a.block_id === blockId,
    );
    if (!last || last.status !== "returned")
      return no("invalid_step", "only a rehearsal the teacher returned can be sent again");
    const choices = speakingChoices(found.block, body.choices);
    if (!choices) return no("invalid", "choose a reply at every speaking turn");
    await tx
      .insertInto("course_speaking_attempt")
      .values({
        org_id: sql`ogc_current_org()`,
        learner_id: learnerId,
        course_ref: ref,
        lesson_id: lessonId,
        block_id: blockId,
        attempt: last.attempt + 1,
        choices: JSON.stringify(choices),
        score: speakingScore(found.block, choices),
        submitted_at: new Date(caller.now()),
      } as never)
      .execute();
    return { ok: true };
  }

  /** The classes of a learner that follow `ref`, among those the caller sees. */
  const classesFor = (
    b: Book,
    list: [string, { name: string; teacherId: string | null }][],
    learnerId: string,
    ref: string,
  ) =>
    list.filter(
      ([id]) =>
        activeLinkOf(b, id)?.courseRef === ref &&
        (b.roster.get(id) ?? []).some((r) => r.learnerId === learnerId),
    );

  app.secured("GET", "/v1/speaking-reviews", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      const b = await loadBook(tx);
      const who = await whoAmI(tx, caller);
      const vis = visible(b, caller, who);
      if (!vis) return reply.code(403).send({ error: "not_allowed" });
      const items: CourseSpeakingReviewItem[] = [];
      for (const a of await latestAttempts(tx)) {
        if (a.status !== "pending") continue;
        const cls = classesFor(b, vis.list, a.learner_id, a.course_ref)[0];
        const found = cls && rehearsalOf(b, a.course_ref, a.learner_id, a.lesson_id, a.block_id);
        if (!cls || !found) continue;
        const choices = a.choices as number[];
        items.push({
          learnerId: a.learner_id,
          learnerName:
            (b.roster.get(cls[0]) ?? []).find((r) => r.learnerId === a.learner_id)?.name ??
            a.learner_id,
          className: cls[1].name,
          ref: a.course_ref,
          courseTitle: found.v.content.title,
          version: found.v.version,
          lessonId: a.lesson_id,
          lessonTitle: found.lesson.title,
          blockId: a.block_id,
          attempt: a.attempt,
          scenario: found.block.scenario,
          score: a.score,
          submittedAt: a.submitted_at.toISOString(),
          turns: found.block.turns.map((t, i) => ({
            coach: t.coach,
            chosen: t.options[choices[i]] ?? null,
            model: t.model,
            natural: choices[i] === t.natural,
          })),
        });
      }
      items.sort((x, z) => x.submittedAt.localeCompare(z.submittedAt));
      const out: SpeakingReviewQueue = { items, mayReview: vis.role === "teacher" };
      return out;
    }),
  );

  app.secured("POST", "/v1/speaking-reviews/decide", async (caller, req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    await caller.write<Plain>("POST /v1/speaking-reviews/decide", { body }, async (tx) => {
      await lock(tx, caller);
      const r = await review(tx, caller, body);
      return {
        status: r.ok ? 200 : STATUS[r.reason],
        body: r,
        audit: {
          action: "courses:review_speaking",
          resource: {
            learnerId: String(body.learnerId ?? ""),
            ref: String(body.ref ?? ""),
            lessonId: String(body.lessonId ?? ""),
            blockId: String(body.blockId ?? ""),
          },
          outcome: r.ok ? ("allowed" as const) : ("denied" as const),
          ...(r.ok ? { after: { decision: body.decision } } : { reason: r.reason }),
        },
      };
    });
  });
  async function review(
    tx: TenantTx,
    caller: Caller,
    body: Record<string, unknown>,
  ): Promise<Plain> {
    const str = (x: unknown) => (typeof x === "string" ? x : "");
    const learnerId = str(body.learnerId);
    const ref = str(body.ref);
    const lessonId = str(body.lessonId);
    const blockId = str(body.blockId);
    const decision = body.decision;
    if (decision !== "approve" && decision !== "return")
      return no("invalid", "decision is approve or return");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (decision === "return" && (note.length < 3 || note.length > 300))
      return no("invalid", "a returned rehearsal needs a note for the learner (3–300)");
    if (decision === "approve" && note.length > 300) return no("invalid", "the note is too long");
    const who = await whoAmI(tx, caller);
    if (!who.teacherId) return no("not_allowed", "the class teacher reviews speaking rehearsals");
    const b = await loadBook(tx);
    const mine = [...b.classes.entries()].filter(([, x]) => x.teacherId === who.teacherId);
    if (!classesFor(b, mine, learnerId, ref).length)
      return no("not_allowed", "only the teacher of the learner's class reviews it");
    const last = (await latestAttempts(tx, learnerId)).find(
      (a) => a.course_ref === ref && a.lesson_id === lessonId && a.block_id === blockId,
    );
    if (!last) return no("not_found");
    if (last.status !== "pending" || last.attempt !== body.attempt)
      return no("invalid_step", "this rehearsal is not waiting for review");
    await tx
      .updateTable("course_speaking_attempt")
      .set({
        status: decision === "approve" ? "approved" : "returned",
        reviewed_at: new Date(caller.now()),
        reviewed_by: who.name,
        note: note || null,
      })
      .where("learner_id", "=", learnerId)
      .where("course_ref", "=", ref)
      .where("lesson_id", "=", lessonId)
      .where("block_id", "=", blockId)
      .where("attempt", "=", last.attempt)
      .execute();
    return { ok: true };
  }

  // ── missions: send again, and the class teacher's review ───────────────────────────────────
  const missionOf = (b: Book, ref: string, learnerId: string, lessonId: string, id: string) => {
    const v = versionFor(b, ref, learnerId);
    const lesson = v?.content.lessons.find((l) => l.id === lessonId);
    const block = lesson?.blocks.find((x) => x.id === id && x.kind === "mission_box") as
      BlockOf<"mission_box"> | undefined;
    return v && lesson && block ? { v, lesson, block } : null;
  };
  app.secured(
    "POST",
    "/v1/me/class-courses/:ref/:lessonId/mission/:blockId",
    async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = req.params as { ref: string; lessonId: string; blockId: string };
      await caller.write<Plain>(
        "POST /v1/me/class-courses/:ref/:lessonId/mission/:blockId",
        { params, body },
        async (tx) => {
          await lock(tx, caller);
          const r = await resend(tx, caller, params, body);
          return {
            status: r.ok ? 200 : STATUS[r.reason],
            body: r,
            audit: {
              action: "courses:learn",
              resource: { ...params, step: "mission" },
              outcome: r.ok ? ("allowed" as const) : ("denied" as const),
              ...(r.ok ? {} : { reason: r.reason }),
            },
          };
        },
      );
    },
  );
  async function resend(
    tx: TenantTx,
    caller: Caller,
    { ref, lessonId, blockId }: { ref: string; lessonId: string; blockId: string },
    body: Record<string, unknown>,
  ): Promise<Plain> {
    const learnerId = await learnerOf(tx, caller);
    if (!learnerId) return no("not_allowed", "learners send their own missions");
    const b = await loadBook(tx);
    if (!openTo(b, learnerId).some((o) => o.ref === ref)) return no("not_found");
    if (!missionOf(b, ref, learnerId, lessonId, blockId)) return no("not_found");
    const last = (await latestMissions(tx, learnerId)).find(
      (a) => a.course_ref === ref && a.lesson_id === lessonId && a.block_id === blockId,
    );
    if (!last || last.status !== "returned")
      return no("invalid_step", "only a mission the teacher returned can be sent again");
    const note = missionNote(body.note ?? "");
    if (note === null)
      return no("invalid", `a mission note is at most ${AUTHORING_LIMITS.missionNote} characters`);
    await tx
      .insertInto("course_mission_attempt")
      .values({
        org_id: sql`ogc_current_org()`,
        learner_id: learnerId,
        course_ref: ref,
        lesson_id: lessonId,
        block_id: blockId,
        attempt: last.attempt + 1,
        note,
        submitted_at: new Date(caller.now()),
      } as never)
      .execute();
    return { ok: true };
  }

  app.secured("GET", "/v1/mission-reviews", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      const b = await loadBook(tx);
      const who = await whoAmI(tx, caller);
      const vis = visible(b, caller, who);
      if (!vis) return reply.code(403).send({ error: "not_allowed" });
      const items: MissionReviewItem[] = [];
      for (const a of await latestMissions(tx)) {
        if (a.status !== "pending") continue;
        const cls = classesFor(b, vis.list, a.learner_id, a.course_ref)[0];
        const found = cls && missionOf(b, a.course_ref, a.learner_id, a.lesson_id, a.block_id);
        if (!cls || !found) continue;
        items.push({
          learnerId: a.learner_id,
          learnerName:
            (b.roster.get(cls[0]) ?? []).find((r) => r.learnerId === a.learner_id)?.name ??
            a.learner_id,
          className: cls[1].name,
          ref: a.course_ref,
          courseTitle: found.v.content.title,
          version: found.v.version,
          lessonId: a.lesson_id,
          lessonTitle: found.lesson.title,
          blockId: a.block_id,
          attempt: a.attempt,
          title: found.block.title,
          task: found.block.task,
          note: a.note,
          submittedAt: a.submitted_at.toISOString(),
        });
      }
      items.sort((x, z) => x.submittedAt.localeCompare(z.submittedAt));
      const out: MissionReviewQueue = { items, mayReview: vis.role === "teacher" };
      return out;
    }),
  );

  app.secured("POST", "/v1/mission-reviews/decide", async (caller, req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    await caller.write<Plain>("POST /v1/mission-reviews/decide", { body }, async (tx) => {
      await lock(tx, caller);
      const r = await reviewMission(tx, caller, body);
      return {
        status: r.ok ? 200 : STATUS[r.reason],
        body: r,
        audit: {
          action: "courses:review_mission",
          resource: {
            learnerId: String(body.learnerId ?? ""),
            ref: String(body.ref ?? ""),
            lessonId: String(body.lessonId ?? ""),
            blockId: String(body.blockId ?? ""),
          },
          outcome: r.ok ? ("allowed" as const) : ("denied" as const),
          ...(r.ok ? { after: { decision: body.decision } } : { reason: r.reason }),
        },
      };
    });
  });
  async function reviewMission(
    tx: TenantTx,
    caller: Caller,
    body: Record<string, unknown>,
  ): Promise<Plain> {
    const str = (x: unknown) => (typeof x === "string" ? x : "");
    const learnerId = str(body.learnerId);
    const ref = str(body.ref);
    const lessonId = str(body.lessonId);
    const blockId = str(body.blockId);
    const decision = body.decision;
    if (decision !== "approve" && decision !== "return")
      return no("invalid", "decision is approve or return");
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (decision === "return" && (note.length < 3 || note.length > 300))
      return no("invalid", "a returned mission needs a note for the learner (3–300)");
    if (decision === "approve" && note.length > 300) return no("invalid", "the note is too long");
    const who = await whoAmI(tx, caller);
    if (!who.teacherId) return no("not_allowed", "the class teacher reviews missions");
    const b = await loadBook(tx);
    const mine = [...b.classes.entries()].filter(([, x]) => x.teacherId === who.teacherId);
    if (!classesFor(b, mine, learnerId, ref).length)
      return no("not_allowed", "only the teacher of the learner's class reviews it");
    const last = (await latestMissions(tx, learnerId)).find(
      (a) => a.course_ref === ref && a.lesson_id === lessonId && a.block_id === blockId,
    );
    if (!last) return no("not_found");
    if (last.status !== "pending" || last.attempt !== body.attempt)
      return no("invalid_step", "this mission is not waiting for review");
    await tx
      .updateTable("course_mission_attempt")
      .set({
        status: decision === "approve" ? "approved" : "returned",
        reviewed_at: new Date(caller.now()),
        reviewed_by: who.name,
        review_note: note || null,
      })
      .where("learner_id", "=", learnerId)
      .where("course_ref", "=", ref)
      .where("lesson_id", "=", lessonId)
      .where("block_id", "=", blockId)
      .where("attempt", "=", last.attempt)
      .execute();
    return { ok: true };
  }

  async function complete(
    tx: TenantTx,
    caller: Caller,
    { ref, lessonId }: { ref: string; lessonId: string },
    body: Record<string, unknown>,
  ): Promise<Out> {
    const learnerId = await learnerOf(tx, caller);
    if (!learnerId)
      return { ok: false, reason: "not_allowed", detail: "learners complete their own lessons" };
    const b = await loadBook(tx);
    if (!openTo(b, learnerId).some((o) => o.ref === ref)) return { ok: false, reason: "not_found" };
    const v = versionFor(b, ref, learnerId);
    const found = v?.content.lessons.find((l) => l.id === lessonId);
    if (!v || !found) return { ok: false, reason: "not_found" };
    const lesson = normalizeLesson(found);
    if (b.done.get(k(learnerId, ref))?.has(lessonId))
      return { ok: false, reason: "invalid_step", detail: "already completed" };
    const answers = body.answers;
    const reflections = body.reflections;
    const spoken = body.speaking ?? {};
    const practiced = body.practice ?? {};
    const confirmed = body.missions ?? {};
    const isObj = (x: unknown): x is Record<string, unknown> =>
      !!x && typeof x === "object" && !Array.isArray(x);
    if (
      !isObj(answers) ||
      !isObj(reflections) ||
      !isObj(spoken) ||
      !isObj(practiced) ||
      !isObj(confirmed)
    )
      return { ok: false, reason: "invalid", detail: "answers and reflections are required" };
    const quizzes = lesson.blocks.filter((x): x is BlockOf<"quiz"> => x.kind === "quiz");
    const prompts = lesson.blocks.filter(
      (x): x is BlockOf<"reflection"> => x.kind === "reflection",
    );
    const rehearsals = lesson.blocks.filter((x): x is BlockOf<"speaking"> => x.kind === "speaking");
    const known = new Set([...quizzes, ...prompts].map((x) => x.id));
    const knownS = new Set(rehearsals.map((x) => x.id));
    const games = lesson.blocks.filter(isPracticeBlock);
    const knownP = new Set(games.map((x) => x.id));
    const tasks = lesson.blocks.filter(
      (x): x is BlockOf<"mission_box"> => x.kind === "mission_box",
    );
    const knownM = new Set(tasks.map((x) => x.id));
    if (
      Object.keys(answers).some((x) => !known.has(x)) ||
      Object.keys(reflections).some((x) => !known.has(x)) ||
      Object.keys(spoken).some((x) => !knownS.has(x)) ||
      Object.keys(practiced).some((x) => !knownP.has(x)) ||
      Object.keys(confirmed).some((x) => !knownM.has(x))
    )
      return {
        ok: false,
        reason: "invalid",
        detail: "answers for blocks that are not in this lesson",
      };
    const keepA: Record<string, number> = {};
    for (const q of quizzes) {
      const a = answers[q.id];
      if (!Number.isInteger(a) || (a as number) < 0 || (a as number) >= q.options.length)
        return { ok: false, reason: "invalid", detail: "answer every question" };
      keepA[q.id] = a as number;
    }
    const keepR: Record<string, string> = {};
    for (const p of prompts) {
      const raw = reflections[p.id];
      const t = typeof raw === "string" ? raw.trim() : "";
      if (!t)
        return { ok: false, reason: "invalid", detail: "write something for each reflection" };
      if (t.length > AUTHORING_LIMITS.reflectionAnswer)
        return {
          ok: false,
          reason: "invalid",
          detail: `a reflection is too long (max ${AUTHORING_LIMITS.reflectionAnswer})`,
        };
      keepR[p.id] = t;
    }
    const keepS: Record<string, number[]> = {};
    for (const r of rehearsals) {
      const c = speakingChoices(r, spoken[r.id]);
      if (!c)
        return { ok: false, reason: "invalid", detail: "choose a reply at every speaking turn" };
      keepS[r.id] = c;
    }
    const keepP: Record<string, number[]> = {};
    for (const g of games) {
      const c = practiceChoices(g, practiced[g.id]);
      if (!c)
        return {
          ok: false,
          reason: "invalid",
          detail:
            g.kind === "practice"
              ? "answer every practice question"
              : g.kind === "eagle_match"
                ? "match every item, each once"
                : "put every event in order",
        };
      keepP[g.id] = c;
    }
    const keepM: Record<string, string> = {};
    for (const m of tasks) {
      if (!(m.id in confirmed))
        return { ok: false, reason: "invalid", detail: "confirm every mission you did" };
      const n = missionNote(confirmed[m.id]);
      if (n === null)
        return {
          ok: false,
          reason: "invalid",
          detail: `a mission note is at most ${AUTHORING_LIMITS.missionNote} characters`,
        };
      keepM[m.id] = n;
    }
    const score = lessonQuizScore(lesson, keepA);
    const practiceScore = lessonPracticeScore(lesson, keepP);
    // The first completed lesson pins the learner to this version.
    if (!b.pins.has(k(learnerId, ref)))
      await tx
        .insertInto("course_progress")
        .values({
          org_id: sql`ogc_current_org()`,
          learner_id: learnerId,
          course_ref: ref,
          version: v.version,
        } as never)
        .execute();
    await tx
      .insertInto("course_lesson_done")
      .values({
        org_id: sql`ogc_current_org()`,
        learner_id: learnerId,
        course_ref: ref,
        lesson_id: lessonId,
        at: new Date(caller.now()),
        score,
        // practice answers (arrays) sit with the quiz answers (numbers): one block id each
        answers: JSON.stringify({ ...keepA, ...keepP }),
        reflections: JSON.stringify(keepR),
        speaking: JSON.stringify(keepS),
      } as never)
      .execute();
    // Each rehearsal goes to the class teacher (attempt 1, pending).
    for (const r of rehearsals)
      await tx
        .insertInto("course_speaking_attempt")
        .values({
          org_id: sql`ogc_current_org()`,
          learner_id: learnerId,
          course_ref: ref,
          lesson_id: lessonId,
          block_id: r.id,
          attempt: 1,
          choices: JSON.stringify(keepS[r.id]),
          score: speakingScore(r, keepS[r.id]),
          submitted_at: new Date(caller.now()),
        } as never)
        .execute();
    // Each mission goes to the class teacher (attempt 1, pending) — XP only once approved.
    for (const m of tasks)
      await tx
        .insertInto("course_mission_attempt")
        .values({
          org_id: sql`ogc_current_org()`,
          learner_id: learnerId,
          course_ref: ref,
          lesson_id: lessonId,
          block_id: m.id,
          attempt: 1,
          note: keepM[m.id],
          submitted_at: new Date(caller.now()),
        } as never)
        .execute();
    return { ok: true, score, practiceScore };
  }
}
