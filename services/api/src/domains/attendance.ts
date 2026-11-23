/*
 * Attendance (teachers) on the Platform API — the rules of the demo's mock adapter
 * (apps/web/src/lib/adapters/mockAttendance.ts, owner decisions 21–22/11), on PostgreSQL:
 *  - the class's own teacher marks each learner present / late / absent, or — for one session —
 *    its substitute; a session that started before the class changed teacher stays with
 *    `held_by`. An access policy can narrow this (e.g. own classes only, not as a substitute);
 *  - only a started, not cancelled session can be marked; every learner every time; the latest
 *    save replaces the earlier one; the summary counts marked sessions only.
 * Which teacher a principal is comes from OGC's own records (teacher.principal_id) — data, not
 * authority: the grant's role and narrowing decide what they may do.
 * Make-up guests stay in the demo for now (their own PR).
 */
import { authorize } from "@ogc/contracts";
import type {
  AttendanceMark,
  AttendanceSummaryRow,
  ClassSession,
  RecordAttendanceResult,
  SessionAttendance,
} from "@ogc/contracts";
import { AttendanceMark as Mark } from "@ogc/contracts";
import { z } from "zod";

// The contract's RecordAttendanceInput types ids as uuids, but OGC's synthetic ids are not
// ("…00000000L001"), and the demo never validated them. Ids here: 1–64 characters, as stored.
const MarksBody = z
  .object({
    marks: z
      .array(z.object({ learnerId: z.string().min(1).max(64), mark: Mark }).strict())
      .min(1)
      .max(500),
  })
  .strict();
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";

type SessRow = {
  id: string;
  class_id: string;
  title: string;
  at: Date;
  state: "scheduled" | "cancelled";
  kind: "regular" | "makeup";
  substitute_id: string | null;
  held_by: string | null;
};

async function teacherIdOf(tx: TenantTx, caller: Caller): Promise<string | null> {
  if (caller.ctx.role !== "teacher") return null;
  const t = await tx
    .selectFrom("teacher")
    .select("id")
    .where("principal_id", "=", caller.ctx.principalId)
    .executeTakeFirst();
  return t?.id ?? null;
}

function status(s: SessRow, marked: boolean, now: number): ClassSession["status"] {
  if (s.state === "cancelled") return "cancelled";
  if (new Date(s.at).getTime() > now) return "upcoming";
  return marked ? "marked" : "to_mark";
}
const toSession = (s: SessRow, marked: boolean, now: number): ClassSession => ({
  id: s.id,
  classId: s.class_id,
  title: s.title,
  at: new Date(s.at).toISOString(),
  status: status(s, marked, now),
  kind: s.kind,
});

/** Owner (as the class teacher, or the teacher it was held by) or substitute; policy applies. */
async function mayMark(tx: TenantTx, caller: Caller, s: SessRow): Promise<boolean> {
  const me = await teacherIdOf(tx, caller);
  if (!me) return false;
  const cls = await tx
    .selectFrom("class")
    .select("teacher_id")
    .where("id", "=", s.class_id)
    .executeTakeFirst();
  const owner = s.held_by ?? cls?.teacher_id ?? null;
  const role = owner === me ? "owner" : s.substitute_id === me ? "substitute" : null;
  if (!role) return false;
  return authorize(caller.ctx, "attendance:mark", { orgId: caller.ctx.orgId, sessionRole: role })
    .allow;
}

async function ownsClass(tx: TenantTx, caller: Caller, classId: string): Promise<boolean> {
  const me = await teacherIdOf(tx, caller);
  if (!me) return false;
  const c = await tx
    .selectFrom("class")
    .select("teacher_id")
    .where("id", "=", classId)
    .executeTakeFirst();
  return !!c && c.teacher_id === me;
}

async function view(tx: TenantTx, s: SessRow, now: number): Promise<SessionAttendance> {
  const [cls, rows, marks] = await Promise.all([
    tx.selectFrom("class").select("name").where("id", "=", s.class_id).executeTakeFirstOrThrow(),
    s.kind === "makeup"
      ? Promise.resolve([])
      : tx
          .selectFrom("roster")
          .innerJoin("learner", "learner.id", "roster.learner_id")
          .select(["learner.id as id", "learner.display_name as name"])
          .where("roster.class_id", "=", s.class_id)
          .orderBy("learner.display_name")
          .execute(),
    tx
      .selectFrom("attendance")
      .select(["learner_id", "mark"])
      .where("session_id", "=", s.id)
      .execute(),
  ]);
  const m = new Map(marks.map((x) => [x.learner_id, x.mark]));
  return {
    session: toSession(s, marks.length > 0, now),
    className: cls.name,
    rows: rows.map((r) => ({
      learnerId: r.id,
      displayName: r.name,
      mark: m.get(r.id) ?? null,
      makeupFor: null,
    })),
  };
}

const sessionById = (tx: TenantTx, id: string) =>
  tx.selectFrom("session").selectAll().where("id", "=", id).executeTakeFirst() as Promise<
    SessRow | undefined
  >;

export function registerAttendance(app: Api): void {
  // The teacher's own classes (Teaching home).
  app.secured("GET", "/v1/me/classes", async (caller, _req, reply) => {
    const out = await caller.tenant(async (tx) => {
      const me = await teacherIdOf(tx, caller);
      if (!me) return null;
      const rows = await tx
        .selectFrom("class")
        .innerJoin("center", "center.id", "class.center_id")
        .select(["class.id as classId", "class.name as className", "center.name as centerName"])
        .where("class.teacher_id", "=", me)
        .orderBy("class.name")
        .execute();
      const counts = await tx.selectFrom("roster").select(["class_id"]).execute();
      return rows.map((r) => ({
        ...r,
        learnerCount: counts.filter((c) => c.class_id === r.classId).length,
      }));
    });
    return out ?? reply.code(403).send({ error: "not_a_teacher" });
  });

  app.secured("GET", "/v1/classes/:id/sessions", async (caller, req, reply) => {
    const id = (req.params as { id: string }).id;
    const out = await caller.tenant(async (tx) => {
      if (!(await ownsClass(tx, caller, id))) return null;
      const now = caller.now();
      const sessions = (await tx
        .selectFrom("session")
        .selectAll()
        .where("class_id", "=", id)
        .orderBy("at", "desc")
        .execute()) as SessRow[];
      const marked = new Set(
        (await tx.selectFrom("attendance").select("session_id").distinct().execute()).map(
          (x) => x.session_id,
        ),
      );
      return sessions.map((s) => toSession(s, marked.has(s.id), now));
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });

  app.secured("GET", "/v1/sessions/:id/attendance", async (caller, req, reply) => {
    const id = (req.params as { id: string }).id;
    const out = await caller.tenant(async (tx) => {
      const s = await sessionById(tx, id);
      if (!s || !(await mayMark(tx, caller, s))) return null;
      return view(tx, s, caller.now());
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });

  app.secured("PUT", "/v1/sessions/:id/attendance", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const parsed = MarksBody.safeParse(req.body);
    await caller.write<RecordAttendanceResult>(
      "PUT /v1/sessions/:id/attendance",
      { id, body: req.body ?? null },
      async (tx) => {
        const fail = (
          reason: Extract<RecordAttendanceResult, { ok: false }>["reason"],
          code: number,
        ) => ({
          status: code,
          body: { ok: false as const, reason },
          audit: {
            action: "attendance:mark",
            resource: { sessionId: id },
            outcome: "denied" as const,
            reason,
          },
        });
        const s = await sessionById(tx, id);
        if (!s || !(await mayMark(tx, caller, s))) return fail("not_found", 404);
        if (s.state === "cancelled") return fail("cancelled", 409);
        if (new Date(s.at).getTime() > caller.now()) return fail("not_started", 409);
        if (!parsed.success) return fail("incomplete", 422);
        const before = await view(tx, s, caller.now());
        const roster = new Set(before.rows.map((r) => r.learnerId));
        const next = new Map<string, AttendanceMark>();
        for (const m of parsed.data.marks) {
          if (!roster.has(m.learnerId)) return fail("not_on_roster", 422);
          next.set(m.learnerId, m.mark);
        }
        if (next.size !== roster.size) return fail("incomplete", 422);
        for (const [learnerId, mark] of next)
          await tx
            .insertInto("attendance")
            .values({
              org_id: caller.ctx.orgId,
              session_id: s.id,
              learner_id: learnerId,
              mark,
              marked_by: caller.ctx.principalId,
            })
            .onConflict((oc) =>
              oc.columns(["session_id", "learner_id"]).doUpdateSet({
                mark,
                marked_by: caller.ctx.principalId,
                marked_at: new Date(caller.now()),
              }),
            )
            .execute();
        const after = await view(tx, s, caller.now());
        return {
          status: 200,
          body: { ok: true as const, attendance: after } satisfies RecordAttendanceResult,
          audit: {
            action: "attendance:mark",
            resource: { sessionId: s.id, classId: s.class_id },
            outcome: "allowed" as const,
            before: before.rows,
            after: after.rows,
          },
        };
      },
    );
  });

  app.secured("GET", "/v1/classes/:id/attendance-summary", async (caller, req, reply) => {
    const id = (req.params as { id: string }).id;
    const out = await caller.tenant(async (tx): Promise<AttendanceSummaryRow[] | null> => {
      if (!(await ownsClass(tx, caller, id))) return null;
      const roster = await tx
        .selectFrom("roster")
        .innerJoin("learner", "learner.id", "roster.learner_id")
        .select(["learner.id as id", "learner.display_name as name"])
        .where("roster.class_id", "=", id)
        .orderBy("learner.display_name")
        .execute();
      const marks = await tx
        .selectFrom("attendance")
        .innerJoin("session", "session.id", "attendance.session_id")
        .select(["attendance.learner_id as learnerId", "attendance.mark as mark"])
        .where("session.class_id", "=", id)
        .where("session.kind", "=", "regular")
        .orderBy("session.at")
        .execute();
      return roster.map((r) => {
        const h = marks.filter((m) => m.learnerId === r.id).map((m) => m.mark);
        const n = (k: AttendanceMark) => h.filter((x) => x === k).length;
        let streak = 0;
        for (let i = h.length - 1; i >= 0 && h[i] === "absent"; i--) streak++;
        return {
          learnerId: r.id,
          displayName: r.name,
          present: n("present"),
          late: n("late"),
          absent: n("absent"),
          marked: h.length,
          attendedPct: h.length ? Math.round(((n("present") + n("late")) / h.length) * 100) : null,
          absentStreak: streak,
        };
      });
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });

  app.secured("GET", "/v1/me/to-mark", async (caller) =>
    caller.tenant(async (tx) => {
      const now = caller.now();
      const sessions = (await tx
        .selectFrom("session")
        .selectAll()
        .where("state", "=", "scheduled")
        .where("at", "<=", new Date(now))
        .orderBy("at")
        .execute()) as SessRow[];
      const marked = new Set(
        (await tx.selectFrom("attendance").select("session_id").distinct().execute()).map(
          (x) => x.session_id,
        ),
      );
      const out: ClassSession[] = [];
      for (const s of sessions)
        if (!marked.has(s.id) && (await mayMark(tx, caller, s))) out.push(toSession(s, false, now));
      return out;
    }),
  );
}
