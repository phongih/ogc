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
 * Not on the Platform yet: the skill profile the demo feeds with quiz scores, Current Students and
 * the Decision Engine's "no class course activity" rule. SYNTHETIC content only.
 */
import { sql } from "kysely";
import { AUTHORING_LIMITS, authorize, lessonQuizScore } from "@ogc/contracts";
import type {
  BlockOf,
  ClassCourseLink,
  CourseLesson,
  CourseVersion,
  LearnerStudioProgress,
  LinkStatus,
  MyClassCourse,
  MyLessonView,
  StudioCourse,
  StudioOverview,
  StudioRefusal,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { latest, load as loadCourses, statusOf, type Stored } from "./courses.js";

export const MAX_PREP_HOURS = 10;

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
    m.set(d.lesson_id, {
      at: d.at.toISOString(),
      score: d.score,
      answers: d.answers as Record<string, number>,
      reflections: d.reflections as Record<string, string>,
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
  const hideAnswers = (l: CourseLesson): CourseLesson => ({
    ...l,
    blocks: l.blocks.map((x) => (x.kind === "quiz" ? { ...x, correct: -1 } : x)),
  });

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
      const lesson = v.content.lessons[idx];
      const done = b.done.get(k(learnerId, ref))?.get(lessonId) ?? null;
      const out: MyLessonView = {
        ref,
        version: v.version,
        lesson: done ? lesson : hideAnswers(lesson),
        index: idx,
        total: v.content.lessons.length,
        completed: done,
      };
      return out;
    }),
  );

  type Out =
    | { ok: true; score: number | null }
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
    const lesson = v?.content.lessons.find((l) => l.id === lessonId);
    if (!v || !lesson) return { ok: false, reason: "not_found" };
    if (b.done.get(k(learnerId, ref))?.has(lessonId))
      return { ok: false, reason: "invalid_step", detail: "already completed" };
    const answers = body.answers;
    const reflections = body.reflections;
    const isObj = (x: unknown): x is Record<string, unknown> =>
      !!x && typeof x === "object" && !Array.isArray(x);
    if (!isObj(answers) || !isObj(reflections))
      return { ok: false, reason: "invalid", detail: "answers and reflections are required" };
    const quizzes = lesson.blocks.filter((x): x is BlockOf<"quiz"> => x.kind === "quiz");
    const prompts = lesson.blocks.filter(
      (x): x is BlockOf<"reflection"> => x.kind === "reflection",
    );
    const known = new Set([...quizzes, ...prompts].map((x) => x.id));
    if (
      Object.keys(answers).some((x) => !known.has(x)) ||
      Object.keys(reflections).some((x) => !known.has(x))
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
    const score = lessonQuizScore(lesson, keepA);
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
        answers: JSON.stringify(keepA),
        reflections: JSON.stringify(keepR),
      } as never)
      .execute();
    return { ok: true, score };
  }
}
