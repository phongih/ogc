/*
 * Course Studio on the Platform API (owner 23/11, slice 3 part A — authoring; part B, in
 * classCourses.ts, links courses to classes and adds My Learning). The rules of the demo's mock adapter
 * (apps/web/src/lib/adapters/mockCourseAuthoring.ts, owner decisions 22/11), on PostgreSQL:
 *  - a course is lessons of typed blocks, checked by the contracts' fail-closed validator; what is
 *    stored is rebuilt from the validated fields only (no unknown keys reach the database);
 *  - draft → submit → a DIFFERENT person approves → an immutable published version. Edits after
 *    publishing are "unpublished changes" until the next approval;
 *  - teachers (courses:author) edit their own courses and read the org's published ones; staff
 *    (courses:author) edit every course of their org and approve — never what they submitted, nor
 *    a draft they edited since the last publication;
 *  - saves carry the draft revision they started from (a newer save wins nothing: "conflict").
 * SYNTHETIC content only; no EduOS code or content.
 */
import { sql } from "kysely";
import { AUTHORING_LIMITS, authorize, contentIssue, normalizeBlock } from "@ogc/contracts";
import type {
  AuthoredCourseDetail,
  AuthoredCourseSummary,
  AuthoredStatus,
  AuthoringRefusal,
  CourseBlock,
  CourseContent,
  CourseReviewEvent,
  CourseVersion,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";

/** Largest course the API stores (canonical JSON characters); the database checks bytes too. */
export const MAX_COURSE_CHARS = 200_000;
const BODY_LIMIT = 512 * 1024;

type Result =
  | { ok: true; ref?: string; revision?: number }
  | { ok: false; reason: AuthoringRefusal; detail?: string };
const no = (reason: AuthoringRefusal, detail?: string): Result => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});
const STATUS: Record<AuthoringRefusal, number> = {
  not_allowed: 403,
  own_step: 403,
  access_policy: 403,
  not_found: 404,
  invalid: 422,
  invalid_step: 409,
  conflict: 409,
};

interface Person {
  id: string; // IIOS principal — "a different person" is decided on this
  name: string;
}
export interface Stored {
  ref: string;
  ownerTeacherId: string | null;
  owner: Person;
  draft: CourseContent;
  revision: number;
  editors: Person[];
  pending: { content: CourseContent; by: Person; at: string } | null;
  versions: CourseVersion[]; // oldest first
  reviews: CourseReviewEvent[]; // oldest first
  updatedAt: string;
}
interface Me {
  person: Person;
  staff: boolean;
  teacherId: string | null;
  authors: boolean;
}

/** Key-order-independent JSON (jsonb does not keep the order keys were written in). */
export function canon(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canon).join(",")}]`;
  if (x && typeof x === "object")
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon((x as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(x);
}
const same = (a: CourseContent, b: CourseContent) => canon(a) === canon(b);

/** The validated course, rebuilt from its known fields only. */
function normalized(c: CourseContent): CourseContent {
  return {
    title: c.title.trim(),
    level: c.level.trim(),
    summary: c.summary,
    lessons: c.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      // an older single vocabulary card is saved as the deck of one it reads as
      blocks: l.blocks.map((b) => normalizeBlock({ ...b } as CourseBlock)),
    })),
  };
}

export async function load(tx: TenantTx, ref?: string): Promise<Stored[]> {
  let cq = tx.selectFrom("authored_course").selectAll();
  let vq = tx.selectFrom("course_version").selectAll();
  let rq = tx.selectFrom("course_review").selectAll();
  if (ref !== undefined) {
    cq = cq.where("ref", "=", ref);
    vq = vq.where("course_ref", "=", ref);
    rq = rq.where("course_ref", "=", ref);
  }
  const [cs, vs, rs] = await Promise.all([
    cq.execute(),
    vq.orderBy("version").execute(),
    rq.orderBy("seq").execute(),
  ]);
  return cs.map((c) => ({
    ref: c.ref,
    ownerTeacherId: c.owner_teacher_id,
    owner: { id: c.owner_principal_id, name: c.owner_name },
    draft: c.draft as CourseContent,
    revision: c.revision,
    editors: c.editors as Person[],
    pending: c.pending_content
      ? {
          content: c.pending_content as CourseContent,
          by: { id: c.pending_by!, name: c.pending_by_name! },
          at: c.pending_at!.toISOString(),
        }
      : null,
    versions: vs
      .filter((v) => v.course_ref === c.ref)
      .map((v) => ({
        version: v.version,
        content: v.content as CourseContent,
        submittedBy: v.submitted_by,
        approvedBy: v.approved_by,
        publishedAt: v.published_at.toISOString(),
        note: v.note,
      })),
    reviews: rs
      .filter((r) => r.course_ref === c.ref)
      .map((r) => ({
        at: r.at.toISOString(),
        by: r.by_name,
        action: r.action,
        version: r.version,
        note: r.note,
      })),
    updatedAt: c.updated_at.toISOString(),
  }));
}

async function whoAmI(tx: TenantTx, caller: Caller): Promise<Me> {
  const { ctx } = caller;
  const staff = ctx.role === "staff";
  let teacherId: string | null = null;
  let name: string | undefined;
  if (staff)
    name = (
      await tx
        .selectFrom("staff_member")
        .select("display_name")
        .where("principal_id", "=", ctx.principalId)
        .executeTakeFirst()
    )?.display_name;
  else if (ctx.role === "teacher") {
    const t = await tx
      .selectFrom("teacher")
      .select(["id", "name"])
      .where("principal_id", "=", ctx.principalId)
      .executeTakeFirst();
    teacherId = t?.id ?? null;
    name = t?.name;
  }
  return {
    person: { id: ctx.principalId, name: name ?? ctx.principalId },
    staff,
    teacherId,
    authors: (staff || !!teacherId) && authorize(ctx, "courses:author", { orgId: ctx.orgId }).allow,
  };
}

// ── rights (the demo's) ─────────────────────────────────────────────────────────────────────
export function statusOf(c: Stored): AuthoredStatus {
  if (c.pending) return "in_review";
  const last = c.versions[c.versions.length - 1];
  if (!last) return "draft";
  return same(last.content, c.draft) ? "published" : "unpublished_changes";
}
export const latest = (c: Stored) => c.versions[c.versions.length - 1] ?? null;

function canEdit(me: Me, c: Stored): boolean {
  if (!me.authors) return false;
  if (me.staff) return true;
  return !!me.teacherId && c.ownerTeacherId === me.teacherId;
}
function canRead(me: Me, c: Stored): boolean {
  if (me.staff) return true;
  return !!me.teacherId && (canEdit(me, c) || c.versions.length > 0);
}
/** Why `me` may NOT approve this course right now (null = may approve). */
function reviewBlock(me: Me, c: Stored): string | null {
  if (!c.pending) return "not in review";
  if (!me.staff) return "Org Admin or center staff approve";
  if (!me.authors) return "your access policy does not allow reviewing courses";
  if (c.pending.by.id === me.person.id) return "you submitted it — someone else approves";
  if (c.editors.some((e) => e.id === me.person.id))
    return "you edited this draft — someone else approves";
  return null;
}
function blockRefusal(block: string): Result {
  if (block.startsWith("you ")) return no("own_step", block);
  if (block.startsWith("your access")) return no("access_policy");
  return no("not_allowed", block);
}

function summaryOf(me: Me, c: Stored): AuthoredCourseSummary {
  const last = latest(c);
  return {
    ref: c.ref,
    title: c.draft.title,
    level: c.draft.level,
    ownerName: c.owner.name,
    status: statusOf(c),
    lessons: last?.content.lessons.length ?? 0,
    publishedVersion: last?.version ?? null,
    updatedAt: c.updatedAt,
    canEdit: canEdit(me, c),
    canReview: reviewBlock(me, c) === null,
  };
}
function detailOf(me: Me, c: Stored, linkedClasses: string[]): AuthoredCourseDetail {
  const editable = canEdit(me, c);
  const insider = editable || me.staff;
  return {
    ...summaryOf(me, c),
    // A teacher who only reads someone else's course sees the published version, not the draft.
    draft: insider ? c.draft : (latest(c)?.content ?? c.draft),
    draftRevision: c.revision,
    pending:
      c.pending && insider
        ? { content: c.pending.content, submittedBy: c.pending.by.name, submittedAt: c.pending.at }
        : null,
    editorsSinceLastPublication: c.editors.map((e) => e.name),
    versions: [...c.versions].reverse(),
    reviews: [...c.reviews].reverse(),
    linkedClasses,
    reviewBlockedReason: c.pending ? reviewBlock(me, c) : null,
  };
}

const noteIssue = (note: unknown, required: boolean): string | null => {
  if (note !== undefined && typeof note !== "string") return "the note must be text";
  const n = (note ?? "").trim();
  if (required && n.length < 3) return "give a note (3–300 characters)";
  return n.length > AUTHORING_LIMITS.note ? "the note is too long (max 300)" : null;
};

async function addReview(
  tx: TenantTx,
  ref: string,
  at: Date,
  by: string,
  action: CourseReviewEvent["action"],
  version: number | null,
  note: string | null,
) {
  await sql`insert into course_review (org_id, course_ref, seq, at, by_name, action, version, note)
            select ogc_current_org(), ${ref}, coalesce(max(seq), 0) + 1, ${at}, ${by}, ${action}, ${version}, ${note}
              from course_review where course_ref = ${ref}`.execute(tx);
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────
export function registerCourses(app: Api): void {
  app.secured("GET", "/v1/courses", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      const me = await whoAmI(tx, caller);
      if (!me.staff && !me.teacherId) return reply.code(403).send({ error: "not_author" });
      const all = await load(tx);
      return {
        courses: all
          .filter((c) => canRead(me, c))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.ref.localeCompare(b.ref))
          .map((c) => summaryOf(me, c)),
        canCreate: me.authors,
      };
    }),
  );

  app.secured("GET", "/v1/courses/:ref", async (caller, req, reply) =>
    caller.tenant(async (tx) => {
      const me = await whoAmI(tx, caller);
      const [c] = await load(tx, (req.params as { ref: string }).ref);
      if (!c || !canRead(me, c)) return reply.code(404).send({ error: "not_found" });
      const linked = await tx
        .selectFrom("class_course_link as l")
        .innerJoin("class as k", "k.id", "l.class_id")
        .select("k.name")
        .where("l.course_ref", "=", c.ref)
        .where("l.status", "=", "linked")
        .orderBy("k.name")
        .execute();
      return detailOf(
        me,
        c,
        linked.map((x) => x.name),
      );
    }),
  );

  /** A write: serialised per organization, audited as courses:author. */
  const write = (
    url: string,
    run: (
      tx: TenantTx,
      me: Me,
      c: Stored | null,
      body: Record<string, unknown>,
      now: Date,
    ) => Promise<Result>,
    opts?: { bodyLimit?: number },
  ) =>
    app.secured(
      "POST",
      url,
      async (caller, req) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const params = req.params as Record<string, string>;
        await caller.write<Result>(`POST ${url}`, { params, body }, async (tx) => {
          await sql`select pg_advisory_xact_lock(hashtext('courses:' || ${caller.ctx.orgId}))`.execute(
            tx,
          );
          const me = await whoAmI(tx, caller);
          let r: Result;
          if (params.ref === undefined) r = await run(tx, me, null, body, new Date(caller.now()));
          else {
            const [c] = await load(tx, params.ref);
            r =
              !c || !canRead(me, c)
                ? no("not_found")
                : await run(tx, me, c, body, new Date(caller.now()));
          }
          return {
            status: r.ok ? 200 : STATUS[r.reason],
            body: r,
            audit: {
              action: "courses:author",
              resource: { ...params },
              outcome: r.ok ? ("allowed" as const) : ("denied" as const),
              ...(r.ok ? { after: { url, ref: r.ref ?? params.ref } } : { reason: r.reason }),
            },
          };
        });
      },
      opts,
    );

  write("/v1/courses", async (tx, me, _c, body, now) => {
    if (!me.staff && !me.teacherId)
      return no("not_allowed", "teachers and center staff write courses");
    if (!me.authors) return no("access_policy");
    if (typeof body.title !== "string" || typeof body.level !== "string")
      return no("invalid", "title and level are required");
    const content: CourseContent = {
      title: body.title.trim(),
      level: body.level.trim(),
      summary: "",
      lessons: [{ id: "l1", title: "Lesson 1", blocks: [] }],
    };
    const issue = contentIssue(content, "draft");
    if (issue) return no("invalid", issue);
    const taken = new Set(
      (await tx.selectFrom("authored_course").select("ref").execute()).map((r) => r.ref),
    );
    let n = taken.size + 1;
    while (taken.has(`CS-${String(n).padStart(3, "0")}`)) n++;
    const ref = `CS-${String(n).padStart(3, "0")}`;
    await tx
      .insertInto("authored_course")
      .values({
        org_id: sql`ogc_current_org()`,
        ref,
        owner_teacher_id: me.teacherId,
        owner_principal_id: me.person.id,
        owner_name: me.person.name,
        draft: JSON.stringify(content),
        revision: 1,
        editors: JSON.stringify([me.person]),
        updated_at: now,
      } as never)
      .execute();
    return { ok: true, ref, revision: 1 };
  });

  write(
    "/v1/courses/:ref/draft",
    async (tx, me, c, body, now) => {
      if (!canEdit(me, c!))
        return me.authors
          ? no("not_allowed", "a teacher edits their own courses")
          : no("access_policy");
      if (c!.pending) return no("invalid_step", "in review — withdraw it to edit");
      if (body.baseRevision !== c!.revision)
        return no("conflict", "someone saved a newer draft — reload to see it");
      const issue = contentIssue(body.content, "draft");
      if (issue) return no("invalid", issue);
      const next = normalized(body.content as CourseContent);
      if (canon(next).length > MAX_COURSE_CHARS) return no("invalid", "the course is too large");
      if (same(next, c!.draft)) return { ok: true, revision: c!.revision };
      const editors = c!.editors.some((e) => e.id === me.person.id)
        ? c!.editors
        : [...c!.editors, me.person];
      await tx
        .updateTable("authored_course")
        .set({
          draft: JSON.stringify(next),
          revision: c!.revision + 1,
          editors: JSON.stringify(editors),
          updated_at: now,
        })
        .where("ref", "=", c!.ref)
        .where("revision", "=", c!.revision)
        .execute();
      return { ok: true, revision: c!.revision + 1 };
    },
    { bodyLimit: BODY_LIMIT },
  );

  write("/v1/courses/:ref/submit", async (tx, me, c, _body, now) => {
    if (!canEdit(me, c!)) return no("not_allowed");
    if (c!.pending) return no("invalid_step", "already in review");
    const last = latest(c!);
    if (last && same(last.content, c!.draft))
      return no("invalid_step", "nothing changed since the last publication");
    const issue = contentIssue(c!.draft, "submit");
    if (issue) return no("invalid", issue);
    await tx
      .updateTable("authored_course")
      .set({
        pending_content: JSON.stringify(c!.draft),
        pending_by: me.person.id,
        pending_by_name: me.person.name,
        pending_at: now,
        updated_at: now,
      })
      .where("ref", "=", c!.ref)
      .execute();
    await addReview(tx, c!.ref, now, me.person.name, "submitted", null, null);
    return { ok: true };
  });

  write("/v1/courses/:ref/withdraw", async (tx, me, c, _body, now) => {
    if (!canEdit(me, c!)) return no("not_allowed");
    if (!c!.pending) return no("invalid_step", "not in review");
    await clearPending(tx, c!.ref, now);
    await addReview(tx, c!.ref, now, me.person.name, "withdrawn", null, null);
    return { ok: true };
  });

  write("/v1/courses/:ref/approve", async (tx, me, c, body, now) => {
    if (!c!.pending) return no("invalid_step", "not in review");
    const block = reviewBlock(me, c!);
    if (block) return blockRefusal(block);
    const n = noteIssue(body.note, false);
    if (n) return no("invalid", n);
    const issue = contentIssue(c!.pending.content, "submit");
    if (issue) return no("invalid", issue); // fail-closed even if the rules tightened
    const note = ((body.note as string | undefined) ?? "").trim() || null;
    const version = (latest(c!)?.version ?? 0) + 1;
    await tx
      .insertInto("course_version")
      .values({
        org_id: sql`ogc_current_org()`,
        course_ref: c!.ref,
        version,
        content: JSON.stringify(c!.pending.content),
        submitted_by: c!.pending.by.name,
        approved_by: me.person.name,
        published_at: now,
        note,
      } as never)
      .execute();
    await addReview(tx, c!.ref, now, me.person.name, "approved", version, note);
    await clearPending(tx, c!.ref, now, true);
    return { ok: true };
  });

  write("/v1/courses/:ref/return", async (tx, me, c, body, now) => {
    if (!c!.pending) return no("invalid_step", "not in review");
    const block = reviewBlock(me, c!);
    if (block) return blockRefusal(block);
    const n = noteIssue(body.note, true);
    if (n) return no("invalid", n);
    await clearPending(tx, c!.ref, now);
    await addReview(
      tx,
      c!.ref,
      now,
      me.person.name,
      "returned",
      null,
      (body.note as string).trim(),
    );
    return { ok: true };
  });
}

async function clearPending(tx: TenantTx, ref: string, now: Date, published = false) {
  await tx
    .updateTable("authored_course")
    .set({
      pending_content: null,
      pending_by: null,
      pending_by_name: null,
      pending_at: null,
      updated_at: now,
      ...(published ? { editors: "[]" } : {}),
    })
    .where("ref", "=", ref)
    .execute();
}
