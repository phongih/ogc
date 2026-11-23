/*
 * Schedule (center staff) on the Platform API — the same rules as the demo's mock adapter
 * (apps/web/src/lib/adapters/mockSchedule.ts, owner decisions 21–22/11), now on PostgreSQL:
 *  - staff only, own organization only; an access policy narrows by center (schedule:manage),
 *    and can make the class teacher / substitute read-only;
 *  - cancelling REQUIRES a replacement time for the whole class;
 *  - started or marked sessions are history: not moved, not cancelled;
 *  - no teacher teaches two overlapping sessions, no room holds two sessions at once;
 *  - a new class teacher applies from sessions not yet started; started ones keep `held_by`.
 * Writes are serialised per organization (advisory lock) so two edits cannot double-book.
 */
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { authorize as authorizeFn } from "@ogc/contracts";
import type {
  ClassSchedule,
  OperationsOverview,
  ScheduleRefusal,
  ScheduleResult,
  ScheduledSession,
  TeacherRef,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const centerTime = (d: Date) => fmt.format(d);
const HISTORY_WINDOW_MS = 4 * 3600_000; // a session that started < 4 h ago still occupies its slot

export interface Snapshot {
  centers: Map<string, string>;
  teachers: Map<string, string>;
  classes: Map<
    string,
    {
      id: string;
      name: string;
      centerId: string;
      teacherId: string | null;
      room: string | null;
      durationMin: number;
    }
  >;
  sessions: {
    id: string;
    classId: string;
    title: string;
    at: Date;
    state: "scheduled" | "cancelled";
    kind: "regular" | "makeup";
    substituteId: string | null;
    heldBy: string | null;
    replacedBy: string | null;
    replaces: string | null;
  }[];
  marked: Set<string>;
  learners: Map<string, number>;
}

export async function snapshot(tx: TenantTx): Promise<Snapshot> {
  const [centers, teachers, classes, sessions, marked, roster] = await Promise.all([
    tx.selectFrom("center").select(["id", "name"]).execute(),
    tx.selectFrom("teacher").select(["id", "name"]).orderBy("name").execute(),
    tx.selectFrom("class").selectAll().orderBy("name").execute(),
    tx.selectFrom("session").selectAll().orderBy("at").execute(),
    tx.selectFrom("attendance").select("session_id").distinct().execute(),
    tx.selectFrom("roster").select(["class_id"]).execute(),
  ]);
  const learners = new Map<string, number>();
  for (const r of roster) learners.set(r.class_id, (learners.get(r.class_id) ?? 0) + 1);
  return {
    centers: new Map(centers.map((c) => [c.id, c.name])),
    teachers: new Map(teachers.map((t) => [t.id, t.name])),
    classes: new Map(
      classes.map((c) => [
        c.id,
        {
          id: c.id,
          name: c.name,
          centerId: c.center_id,
          teacherId: c.teacher_id,
          room: c.room,
          durationMin: c.duration_min,
        },
      ]),
    ),
    sessions: sessions.map((s) => ({
      id: s.id,
      classId: s.class_id,
      title: s.title,
      at: new Date(s.at),
      state: s.state,
      kind: s.kind,
      substituteId: s.substitute_id,
      heldBy: s.held_by,
      replacedBy: s.replaced_by,
      replaces: s.replaces,
    })),
    marked: new Set(marked.map((m) => m.session_id)),
    learners,
  };
}

type Sess = Snapshot["sessions"][number];

const ref = (snap: Snapshot, id: string | null): TeacherRef | null =>
  id && snap.teachers.has(id) ? { id, name: snap.teachers.get(id)! } : null;

function classSchedule(snap: Snapshot, classId: string, now: number): ClassSchedule {
  const c = snap.classes.get(classId)!;
  return {
    classId,
    className: c.name,
    centerId: c.centerId,
    centerName: snap.centers.get(c.centerId) ?? "Center",
    teacher: ref(snap, c.teacherId),
    learnerCount: snap.learners.get(classId) ?? 0,
    sessions: snap.sessions
      .filter((s) => s.classId === classId)
      .map((s): ScheduledSession => ({
        id: s.id,
        classId: s.classId,
        title: s.title,
        at: s.at.toISOString(),
        state: s.state,
        kind: s.kind,
        started: s.at.getTime() <= now,
        marked: snap.marked.has(s.id),
        substitute: ref(snap, s.substituteId),
        heldBy: ref(snap, s.heldBy),
        replacedBy: s.replacedBy,
        replaces: s.replaces,
      })),
  };
}

// ── clashes (same rules and words as apps/web/src/lib/adapters/clashes.ts) ─────────────────
export interface Slot {
  label: string;
  at: Date;
  durationMin: number;
  teacherId: string | null;
  centerId: string | null;
  room: string | null;
}
const teacherOf = (snap: Snapshot, s: Sess) =>
  s.substituteId ?? s.heldBy ?? snap.classes.get(s.classId)?.teacherId ?? null;
function slotOf(snap: Snapshot, s: Pick<Sess, "classId" | "at">, teacherId: string | null): Slot {
  const c = snap.classes.get(s.classId)!;
  return {
    label: c.name,
    at: s.at,
    durationMin: c.durationMin,
    teacherId,
    centerId: c.centerId,
    room: c.room,
  };
}
const overlap = (a: Slot, b: Slot) =>
  a.at.getTime() < b.at.getTime() + b.durationMin * 60_000 &&
  b.at.getTime() < a.at.getTime() + a.durationMin * 60_000;
function why(snap: Snapshot, cand: Slot, other: Slot): string | null {
  if (!overlap(cand, other)) return null;
  if (cand.teacherId && cand.teacherId === other.teacherId)
    return `${snap.teachers.get(cand.teacherId) ?? "This teacher"} already teaches ${other.label} on ${centerTime(other.at)}`;
  if (cand.room && cand.room === other.room && cand.centerId && cand.centerId === other.centerId)
    return `${cand.room} at ${snap.centers.get(cand.centerId) ?? "this center"} is already used by ${other.label} on ${centerTime(other.at)}`;
  return null;
}
export function clashes(
  snap: Snapshot,
  now: number,
  cands: Slot[],
  exclude: Set<string> = new Set(),
): string[] {
  const busy = snap.sessions
    .filter(
      (s) =>
        s.state === "scheduled" && !exclude.has(s.id) && s.at.getTime() + HISTORY_WINDOW_MS > now,
    )
    .map((s) => slotOf(snap, s, teacherOf(snap, s)));
  const out = new Set<string>();
  cands.forEach((c, i) => {
    for (const b of busy) {
      const m = why(snap, c, b);
      if (m) out.add(m);
    }
    for (const o of cands.slice(i + 1)) {
      const m = why(snap, o, c);
      if (m) out.add(m);
    }
  });
  const all = [...out];
  return all.length > 5 ? [...all.slice(0, 5), `…and ${all.length - 5} more`] : all;
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────
const STATUS: Record<ScheduleRefusal, number> = {
  not_found: 404,
  not_staff: 403,
  access_policy: 403,
  in_past: 422,
  already_started: 409,
  cancelled: 409,
  unknown_teacher: 422,
  same_teacher: 422,
  clash: 409,
};
const parseFuture = (v: unknown, now: number): Date | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t > now ? new Date(t) : null;
};

export function registerSchedule(app: Api): void {
  // Run a schedule write: staff only, serialised per org, idempotent, audited.
  const scheduleWrite = async (
    caller: Caller,
    route: string,
    body: unknown,
    target: { classId?: string; sessionId?: string },
    run: (
      tx: TenantTx,
      snap: Snapshot,
      cls: NonNullable<ReturnType<Snapshot["classes"]["get"]>>,
      sess: Sess | null,
    ) => Promise<ScheduleResult>,
  ) =>
    caller.write<ScheduleResult>(route, body, async (tx) => {
      const refuse = (reason: ScheduleRefusal, extra: { clashes?: string[] } = {}) => ({
        status: STATUS[reason],
        body: { ok: false as const, reason, ...extra },
        audit: { action: "schedule:manage", resource: target, outcome: "denied" as const, reason },
      });
      if (caller.ctx.role !== "staff") return refuse("not_staff");
      await sql`select pg_advisory_xact_lock(hashtext('schedule:' || ${caller.ctx.orgId}))`.execute(
        tx,
      );
      const snap = await snapshot(tx);
      const sess = target.sessionId
        ? (snap.sessions.find((s) => s.id === target.sessionId) ?? null)
        : null;
      const classId = sess?.classId ?? target.classId;
      const cls = classId ? snap.classes.get(classId) : undefined;
      if (!cls || (target.sessionId && !sess)) return refuse("not_found");
      const res = await run(tx, snap, cls, sess);
      if (!res.ok) return refuse(res.reason, res.clashes ? { clashes: res.clashes } : {});
      return {
        status: 200,
        body: res,
        audit: {
          action: "schedule:manage",
          resource: target,
          outcome: "allowed" as const,
          after: body,
        },
      };
    });

  // Inside a write the refusal itself is audited once by scheduleWrite, so decide quietly here.
  const policy = async (
    caller: Caller,
    centerId: string,
    field?: "classTeacher" | "substitute",
  ) => {
    const d = authorizeFn(caller.ctx, "schedule:manage", { orgId: caller.ctx.orgId, centerId });
    return d.allow && (!field || !d.readonly.includes(field));
  };
  // Listing narrows silently (no audit row per hidden class).
  const authorizeQuiet = (caller: Caller, centerId: string) =>
    authorizeFn(caller.ctx, "schedule:manage", { orgId: caller.ctx.orgId, centerId }).allow;
  const fresh = async (tx: TenantTx, classId: string, now: number): Promise<ScheduleResult> => ({
    ok: true,
    classSchedule: classSchedule(await snapshot(tx), classId, now),
  });
  const isHistory = (snap: Snapshot, s: Sess, now: number) =>
    s.at.getTime() <= now || snap.marked.has(s.id);

  app.secured("GET", "/v1/schedule", async (caller, _req, reply) => {
    if (caller.ctx.role !== "staff") return reply.code(403).send({ error: "not_staff" });
    const now = caller.now();
    const snap = await caller.tenant(snapshot);
    const out: OperationsOverview = {
      orgId: caller.ctx.orgId,
      teachers: [...snap.teachers].map(([id, name]) => ({ id, name })),
      classes: [],
    };
    for (const c of snap.classes.values()) {
      if (authorizeQuiet(caller, c.centerId)) out.classes.push(classSchedule(snap, c.id, now));
    }
    return out;
  });
  app.secured("POST", "/v1/sessions/:id/reschedule", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { at?: unknown };
    await scheduleWrite(
      caller,
      "POST /v1/sessions/:id/reschedule",
      { id, ...body },
      { sessionId: id },
      async (tx, snap, cls, s) => {
        const now = caller.now();
        if (!(await policy(caller, cls.centerId))) return { ok: false, reason: "access_policy" };
        if (s!.state === "cancelled") return { ok: false, reason: "cancelled" };
        if (isHistory(snap, s!, now)) return { ok: false, reason: "already_started" };
        const at = parseFuture(body.at, now);
        if (!at) return { ok: false, reason: "in_past" };
        const c = clashes(
          snap,
          now,
          [slotOf(snap, { classId: cls.id, at }, teacherOf(snap, s!))],
          new Set([s!.id]),
        );
        if (c.length) return { ok: false, reason: "clash", clashes: c };
        await tx.updateTable("session").set({ at }).where("id", "=", s!.id).execute();
        return fresh(tx, cls.id, now);
      },
    );
  });

  app.secured("POST", "/v1/sessions/:id/cancel", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { replacementAt?: unknown };
    await scheduleWrite(
      caller,
      "POST /v1/sessions/:id/cancel",
      { id, ...body },
      { sessionId: id },
      async (tx, snap, cls, s) => {
        const now = caller.now();
        if (!(await policy(caller, cls.centerId))) return { ok: false, reason: "access_policy" };
        if (s!.state === "cancelled") return { ok: false, reason: "cancelled" };
        if (isHistory(snap, s!, now)) return { ok: false, reason: "already_started" };
        const at = parseFuture(body.replacementAt, now);
        if (!at) return { ok: false, reason: "in_past" };
        const c = clashes(
          snap,
          now,
          [slotOf(snap, { classId: cls.id, at }, teacherOf(snap, s!))],
          new Set([s!.id]),
        );
        if (c.length) return { ok: false, reason: "clash", clashes: c };
        const replId = `ses_${randomUUID()}`;
        await tx
          .insertInto("session")
          .values({
            org_id: caller.ctx.orgId,
            id: replId,
            class_id: cls.id,
            title: s!.title,
            at,
            kind: s!.kind,
            substitute_id: s!.kind === "makeup" ? s!.substituteId : null,
            held_by: null,
            replaced_by: null,
            replaces: s!.id,
          })
          .execute();
        await tx
          .updateTable("session")
          .set({ state: "cancelled", replaced_by: replId, substitute_id: null })
          .where("id", "=", s!.id)
          .execute();
        return fresh(tx, cls.id, now);
      },
    );
  });

  app.secured("POST", "/v1/classes/:id/sessions", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { title?: unknown; at?: unknown };
    await scheduleWrite(
      caller,
      "POST /v1/classes/:id/sessions",
      { id, ...body },
      { classId: id },
      async (tx, snap, cls) => {
        const now = caller.now();
        if (!(await policy(caller, cls.centerId))) return { ok: false, reason: "access_policy" };
        const at = parseFuture(body.at, now);
        if (!at) return { ok: false, reason: "in_past" };
        const title =
          (typeof body.title === "string" ? body.title.trim() : "").slice(0, 120) ||
          "Extra session";
        const c = clashes(snap, now, [slotOf(snap, { classId: cls.id, at }, cls.teacherId)]);
        if (c.length) return { ok: false, reason: "clash", clashes: c };
        await tx
          .insertInto("session")
          .values({
            org_id: caller.ctx.orgId,
            id: `ses_${randomUUID()}`,
            class_id: cls.id,
            title,
            at,
            substitute_id: null,
            held_by: null,
            replaced_by: null,
            replaces: null,
          })
          .execute();
        return fresh(tx, cls.id, now);
      },
    );
  });

  app.secured("PUT", "/v1/classes/:id/teacher", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { teacherId?: unknown };
    await scheduleWrite(
      caller,
      "PUT /v1/classes/:id/teacher",
      { id, ...body },
      { classId: id },
      async (tx, snap, cls) => {
        const now = caller.now();
        if (!(await policy(caller, cls.centerId, "classTeacher")))
          return { ok: false, reason: "access_policy" };
        const teacherId = typeof body.teacherId === "string" ? body.teacherId : "";
        if (!snap.teachers.has(teacherId)) return { ok: false, reason: "unknown_teacher" };
        const taught = snap.sessions.filter(
          (x) =>
            x.classId === cls.id &&
            x.state === "scheduled" &&
            x.at.getTime() > now &&
            (!x.substituteId || x.substituteId === teacherId),
        );
        const c = clashes(
          snap,
          now,
          taught.map((x) => slotOf(snap, x, teacherId)),
          new Set(taught.map((x) => x.id)),
        );
        if (c.length) return { ok: false, reason: "clash", clashes: c };
        const previous = cls.teacherId;
        if (previous && previous !== teacherId)
          for (const s of snap.sessions)
            if (
              s.classId === cls.id &&
              s.state === "scheduled" &&
              s.at.getTime() <= now &&
              !s.substituteId &&
              !s.heldBy
            )
              await tx
                .updateTable("session")
                .set({ held_by: previous })
                .where("id", "=", s.id)
                .execute();
        await tx
          .updateTable("class")
          .set({ teacher_id: teacherId })
          .where("id", "=", cls.id)
          .execute();
        await tx
          .updateTable("session")
          .set({ substitute_id: null })
          .where("class_id", "=", cls.id)
          .where("substitute_id", "=", teacherId)
          .execute();
        return fresh(tx, cls.id, now);
      },
    );
  });

  app.secured("PUT", "/v1/sessions/:id/substitute", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { teacherId?: unknown };
    await scheduleWrite(
      caller,
      "PUT /v1/sessions/:id/substitute",
      { id, ...body },
      { sessionId: id },
      async (tx, snap, cls, s) => {
        const now = caller.now();
        if (!(await policy(caller, cls.centerId, "substitute")))
          return { ok: false, reason: "access_policy" };
        if (s!.state === "cancelled") return { ok: false, reason: "cancelled" };
        if (snap.marked.has(s!.id)) return { ok: false, reason: "already_started" };
        const teacherId =
          body.teacherId === null ? null : typeof body.teacherId === "string" ? body.teacherId : "";
        if (teacherId !== null) {
          if (!snap.teachers.has(teacherId)) return { ok: false, reason: "unknown_teacher" };
          if (cls.teacherId === teacherId) return { ok: false, reason: "same_teacher" };
          const c = clashes(snap, now, [slotOf(snap, s!, teacherId)], new Set([s!.id]));
          if (c.length) return { ok: false, reason: "clash", clashes: c };
        }
        await tx
          .updateTable("session")
          .set({ substitute_id: teacherId })
          .where("id", "=", s!.id)
          .execute();
        return fresh(tx, cls.id, now);
      },
    );
  });
}
