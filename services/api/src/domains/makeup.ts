/*
 * Make-up ledger on the Platform API — "no learner loses a lesson" (owner, 21/11), the rules of the
 * demo's mock adapter (apps/web/src/lib/adapters/mockMakeup.ts) on PostgreSQL:
 *  - items are DERIVED from attendance: every absent mark at a regular session of the learner's own
 *    class is an item, so none can be forgotten or deleted by hand. It closes only when the learner
 *    is marked present / late at the booked make-up, or self-study is confirmed by the learner's
 *    own class teacher. Correcting the absence removes the item;
 *  - staff arrange: join another class's session of the SAME unit (same course), a separate
 *    make-up session (every learner still missing that unit is booked into it; no teacher clash),
 *    or self-study; an access policy narrows by center (makeup:manage);
 *  - due 14 days after the missed session; overdue first on the board;
 *  - learners see their own items and submit self-study; a guardian sees linked learners' items,
 *    read-only (links are synthetic seed only — owner 23/11); the class teacher confirms or
 *    returns self-study.
 * One deliberate difference from the demo: a booking into a session that was later CANCELLED
 * counts as open again (the arrangement failed), instead of staying "booked".
 */
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { authorize, MAKEUP_DEADLINE_DAYS } from "@ogc/contracts";
import type {
  MakeupBoard,
  MakeupBooking,
  MakeupItem,
  MakeupItemResult,
  MakeupOption,
  MakeupRefusal,
  MakeupResult,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { clashes, snapshot } from "./schedule.js";

const DAY = 86_400_000;

interface Ledger {
  classes: Map<
    string,
    { name: string; centerId: string; teacherId: string | null; courseId: string | null }
  >;
  teachers: Map<string, string>;
  learners: Map<string, { name: string; principalId: string | null }>;
  roster: Set<string>; // `${classId}|${learnerId}`
  sessions: Map<
    string,
    {
      id: string;
      classId: string;
      title: string;
      at: Date;
      state: "scheduled" | "cancelled";
      kind: "regular" | "makeup";
      substituteId: string | null;
      heldBy: string | null;
    }
  >;
  marks: Map<string, "present" | "late" | "absent">; // `${sessionId}|${learnerId}`
  bookings: Map<string, string>; // itemId → sessionId
  selfStudies: Map<
    string,
    {
      submittedAt: Date | null;
      note: string | null;
      returnedNote: string | null;
      confirmedAt: Date | null;
    }
  >;
}

export const itemId = (missedSessionId: string, learnerId: string) =>
  `${missedSessionId}::${learnerId}`;

export async function loadLedger(tx: TenantTx): Promise<Ledger> {
  const [classes, teachers, learners, roster, sessions, marks, bookings, selfs] = await Promise.all(
    [
      tx
        .selectFrom("class")
        .select(["id", "name", "center_id", "teacher_id", "course_id"])
        .execute(),
      tx.selectFrom("teacher").select(["id", "name"]).execute(),
      tx.selectFrom("learner").select(["id", "display_name", "principal_id"]).execute(),
      tx.selectFrom("roster").select(["class_id", "learner_id"]).execute(),
      tx.selectFrom("session").selectAll().execute(),
      tx.selectFrom("attendance").select(["session_id", "learner_id", "mark"]).execute(),
      tx
        .selectFrom("makeup_booking")
        .select(["missed_session_id", "learner_id", "session_id"])
        .execute(),
      tx.selectFrom("makeup_selfstudy").selectAll().execute(),
    ],
  );
  return {
    classes: new Map(
      classes.map((c) => [
        c.id,
        { name: c.name, centerId: c.center_id, teacherId: c.teacher_id, courseId: c.course_id },
      ]),
    ),
    teachers: new Map(teachers.map((t) => [t.id, t.name])),
    learners: new Map(
      learners.map((l) => [l.id, { name: l.display_name, principalId: l.principal_id }]),
    ),
    roster: new Set(roster.map((r) => `${r.class_id}|${r.learner_id}`)),
    sessions: new Map(
      sessions.map((s) => [
        s.id,
        {
          id: s.id,
          classId: s.class_id,
          title: s.title,
          at: new Date(s.at),
          state: s.state,
          kind: s.kind,
          substituteId: s.substitute_id,
          heldBy: s.held_by,
        },
      ]),
    ),
    marks: new Map(marks.map((m) => [`${m.session_id}|${m.learner_id}`, m.mark])),
    bookings: new Map(
      bookings.map((b) => [itemId(b.missed_session_id, b.learner_id), b.session_id]),
    ),
    selfStudies: new Map(
      selfs.map((x) => [
        itemId(x.missed_session_id, x.learner_id),
        {
          submittedAt: x.submitted_at,
          note: x.note,
          returnedNote: x.returned_note,
          confirmedAt: x.confirmed_at,
        },
      ]),
    ),
  };
}

type LSession = Ledger["sessions"] extends Map<string, infer V> ? V : never;
const teacherOfSession = (l: Ledger, s: LSession) =>
  s.substituteId ?? s.heldBy ?? l.classes.get(s.classId)?.teacherId ?? null;
const nameOfTeacher = (l: Ledger, id: string | null) => (id ? (l.teachers.get(id) ?? null) : null);

function itemFor(l: Ledger, missed: LSession, learnerId: string, now: number): MakeupItem {
  const id = itemId(missed.id, learnerId);
  const due = missed.at.getTime() + MAKEUP_DEADLINE_DAYS * DAY;
  const cls = l.classes.get(missed.classId)!;
  const base = {
    id,
    learnerId,
    learnerName: l.learners.get(learnerId)?.name ?? "Learner",
    classId: missed.classId,
    className: cls.name,
    unitTitle: missed.title,
    missedSessionId: missed.id,
    missedAt: missed.at.toISOString(),
    dueAt: new Date(due).toISOString(),
  };
  const self = l.selfStudies.get(id);
  if (self) {
    const status = self.confirmedAt ? "done" : self.submittedAt ? "to_confirm" : "booked";
    return {
      ...base,
      status,
      overdue: status !== "done" && now > due,
      missedMakeup: false,
      booking: {
        kind: "selfstudy",
        sessionId: null,
        className: null,
        at: null,
        teacherName: nameOfTeacher(l, cls.teacherId), // the class teacher confirms
        selfStudy: {
          submittedAt: self.submittedAt?.toISOString() ?? null,
          note: self.note,
          returnedNote: self.returnedNote,
          confirmedAt: self.confirmedAt?.toISOString() ?? null,
        },
      },
    };
  }
  const bookedId = l.bookings.get(id);
  const booked = bookedId ? l.sessions.get(bookedId) : undefined;
  const mark = booked ? (l.marks.get(`${booked.id}|${learnerId}`) ?? null) : null;
  const status =
    !booked || mark === "absent" || (booked.state === "cancelled" && !mark)
      ? "open"
      : mark
        ? "done"
        : "booked";
  const booking: MakeupBooking | null = booked
    ? {
        kind: booked.kind === "makeup" || booked.classId === missed.classId ? "makeup" : "join",
        sessionId: booked.id,
        className: l.classes.get(booked.classId)?.name ?? null,
        at: booked.at.toISOString(),
        teacherName: nameOfTeacher(l, teacherOfSession(l, booked)),
        selfStudy: null,
      }
    : null;
  return {
    ...base,
    status,
    overdue: status !== "done" && now > due,
    missedMakeup: mark === "absent",
    booking,
  };
}

const RANK = (i: MakeupItem) =>
  i.overdue ? 0 : i.status === "open" ? 1 : i.status === "booked" ? 2 : 3;

/** Every live item in the organization: absent at a regular session of the learner's own class. */
export function makeupItems(l: Ledger, now: number): MakeupItem[] {
  const out: MakeupItem[] = [];
  for (const [key, mark] of l.marks) {
    if (mark !== "absent") continue;
    const [sessionId, learnerId] = key.split("|");
    const s = l.sessions.get(sessionId);
    if (!s || s.kind !== "regular" || !l.roster.has(`${s.classId}|${learnerId}`)) continue;
    out.push(itemFor(l, s, learnerId, now));
  }
  return out.sort((a, b) => RANK(a) - RANK(b) || Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

/** Learners booked into `sessionId` whose item is still live (for the attendance sheet). */
export function guestsOf(
  l: Ledger,
  sessionId: string,
): { learnerId: string; fromClassId: string }[] {
  const out: { learnerId: string; fromClassId: string }[] = [];
  for (const [id, sid] of l.bookings) {
    if (sid !== sessionId) continue;
    const [missed, learnerId] = id.split("::");
    const m = l.sessions.get(missed);
    if (!m || m.kind !== "regular" || l.marks.get(`${missed}|${learnerId}`) !== "absent") continue;
    if (!l.roster.has(`${m.classId}|${learnerId}`)) continue;
    out.push({ learnerId, fromClassId: m.classId });
  }
  return out;
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────
const STATUS: Record<MakeupRefusal, number> = {
  not_staff: 403,
  not_found: 404,
  access_policy: 403,
  already_done: 409,
  not_an_option: 422,
  in_past: 422,
  unknown_teacher: 422,
  nothing_open: 409,
  not_self_study: 409,
  not_submitted: 409,
  note_required: 422,
  clash: 409,
};

const mayArrange = (caller: Caller, centerId: string) =>
  authorize(caller.ctx, "makeup:manage", { orgId: caller.ctx.orgId, centerId }).allow;

function boardOf(l: Ledger, caller: Caller, now: number): MakeupBoard {
  const items = makeupItems(l, now).filter((i) =>
    mayArrange(caller, l.classes.get(i.classId)!.centerId),
  );
  const count = (f: (i: MakeupItem) => boolean) => items.filter(f).length;
  return {
    items,
    counts: {
      open: count((i) => i.status === "open"),
      booked: count((i) => i.status === "booked"),
      toConfirm: count((i) => i.status === "to_confirm"),
      done: count((i) => i.status === "done"),
      overdue: count((i) => i.overdue),
    },
  };
}

function optionsFor(l: Ledger, item: MakeupItem, now: number): LSession[] {
  const course = l.classes.get(item.classId)?.courseId ?? null;
  return [...l.sessions.values()]
    .filter(
      (s) =>
        s.state === "scheduled" &&
        s.at.getTime() > now &&
        s.title === item.unitTitle &&
        course !== null &&
        l.classes.get(s.classId)?.courseId === course &&
        (s.kind === "makeup" || s.classId !== item.classId) &&
        s.id !== item.booking?.sessionId,
    )
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

async function myTeacherId(tx: TenantTx, caller: Caller): Promise<string | null> {
  if (caller.ctx.role !== "teacher") return null;
  const t = await tx
    .selectFrom("teacher")
    .select("id")
    .where("principal_id", "=", caller.ctx.principalId)
    .executeTakeFirst();
  return t?.id ?? null;
}

/** Learner: own record. Guardian: pre-established links only (seed). Everyone else: none. */
async function ownLearnerIds(tx: TenantTx, caller: Caller): Promise<string[]> {
  if (caller.ctx.role === "learner") {
    const r = await tx
      .selectFrom("learner")
      .select("id")
      .where("principal_id", "=", caller.ctx.principalId)
      .executeTakeFirst();
    return r ? [r.id] : [];
  }
  if (caller.ctx.role === "guardian")
    return (
      await tx
        .selectFrom("guardian_link")
        .select("learner_id")
        .where("guardian_principal_id", "=", caller.ctx.principalId)
        .execute()
    ).map((r) => r.learner_id);
  return [];
}

const ITEM = /^[A-Za-z0-9_.:-]{3,140}$/;
type Step = { ok: true } | { ok: false; reason: MakeupRefusal; clashes?: string[] };
const OK: Step = { ok: true };
const splitItem = (id: string) => {
  const [missed, learner, ...rest] = id.split("::");
  return missed && learner && rest.length === 0 ? { missed, learner } : null;
};

export function registerMakeup(app: Api): void {
  const lockSchedule = (tx: TenantTx, orgId: string) =>
    sql`select pg_advisory_xact_lock(hashtext('schedule:' || ${orgId}))`.execute(tx);

  /** Staff write: not_staff / not_found / access_policy checked here; audited; idempotent. */
  const staffWrite = (
    caller: Caller,
    route: string,
    id: string,
    body: unknown,
    run: (tx: TenantTx, l: Ledger, item: MakeupItem, now: number) => Promise<Step>,
  ) =>
    caller.write<MakeupResult>(route, { id, body }, async (tx) => {
      const refuse = (reason: MakeupRefusal, clashList?: string[]) => ({
        status: STATUS[reason],
        body: { ok: false as const, reason, ...(clashList ? { clashes: clashList } : {}) },
        audit: {
          action: "makeup:manage",
          resource: { item: id },
          outcome: "denied" as const,
          reason,
        },
      });
      if (caller.ctx.role !== "staff") return refuse("not_staff");
      if (!ITEM.test(id) || !splitItem(id)) return refuse("not_found");
      await lockSchedule(tx, caller.ctx.orgId); // make-up sessions share the schedule's lock
      const now = caller.now();
      const l = await loadLedger(tx);
      const item = makeupItems(l, now).find((i) => i.id === id);
      if (!item) return refuse("not_found");
      if (!mayArrange(caller, l.classes.get(item.classId)!.centerId))
        return refuse("access_policy");
      if (item.status === "done") return refuse("already_done");
      const r = await run(tx, l, item, now);
      if (!r.ok) return refuse(r.reason, r.clashes);
      return {
        status: 200,
        body: { ok: true as const, board: boardOf(await loadLedger(tx), caller, now) },
        audit: {
          action: "makeup:manage",
          resource: { item: id },
          outcome: "allowed" as const,
          after: body,
        },
      };
    });

  // ── staff ──
  app.secured("GET", "/v1/makeups", async (caller, _req, reply) => {
    if (caller.ctx.role !== "staff") return reply.code(403).send({ error: "not_staff" });
    return caller.tenant(async (tx) => boardOf(await loadLedger(tx), caller, caller.now()));
  });

  app.secured("GET", "/v1/makeups/:item/options", async (caller, req, reply) => {
    if (caller.ctx.role !== "staff") return reply.code(403).send({ error: "not_staff" });
    const id = (req.params as { item: string }).item;
    const out = await caller.tenant(async (tx): Promise<MakeupOption[] | null> => {
      const now = caller.now();
      const l = await loadLedger(tx);
      const item = makeupItems(l, now).find((i) => i.id === id);
      if (!item || !mayArrange(caller, l.classes.get(item.classId)!.centerId)) return null;
      return optionsFor(l, item, now)
        .filter((s) => mayArrange(caller, l.classes.get(s.classId)!.centerId))
        .map((s) => ({
          sessionId: s.id,
          kind: s.kind === "makeup" ? "makeup" : "join",
          className: l.classes.get(s.classId)!.name,
          title: s.title,
          at: s.at.toISOString(),
          teacherName: nameOfTeacher(l, teacherOfSession(l, s)),
        }));
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });

  app.secured("POST", "/v1/makeups/:item/book", async (caller, req) => {
    const id = (req.params as { item: string }).item;
    const b = (req.body ?? {}) as { sessionId?: unknown };
    await staffWrite(
      caller,
      "POST /v1/makeups/:item/book",
      id,
      req.body ?? null,
      async (tx, l, item, now) => {
        const target = optionsFor(l, item, now).find((s) => s.id === b.sessionId);
        if (!target) return { ok: false, reason: "not_an_option" } as Step;
        if (!mayArrange(caller, l.classes.get(target.classId)!.centerId))
          return { ok: false, reason: "access_policy" } as Step;
        const k = splitItem(id)!;
        await tx
          .deleteFrom("makeup_selfstudy")
          .where("missed_session_id", "=", k.missed)
          .where("learner_id", "=", k.learner)
          .execute();
        await tx
          .deleteFrom("makeup_booking")
          .where("missed_session_id", "=", k.missed)
          .where("learner_id", "=", k.learner)
          .execute();
        await tx
          .insertInto("makeup_booking")
          .values({
            org_id: caller.ctx.orgId,
            missed_session_id: k.missed,
            learner_id: k.learner,
            session_id: target.id,
            booked_by: caller.ctx.principalId,
          })
          .execute();
        return OK;
      },
    );
  });

  app.secured("POST", "/v1/makeups/:item/makeup-session", async (caller, req) => {
    const id = (req.params as { item: string }).item;
    const b = (req.body ?? {}) as { at?: unknown; teacherId?: unknown };
    await staffWrite(
      caller,
      "POST /v1/makeups/:item/makeup-session",
      id,
      req.body ?? null,
      async (tx, l, item, now) => {
        const at = typeof b.at === "string" ? Date.parse(b.at) : NaN;
        if (!(at > now)) return { ok: false, reason: "in_past" };
        const teacherId = typeof b.teacherId === "string" ? b.teacherId : "";
        if (!l.teachers.has(teacherId)) return { ok: false, reason: "unknown_teacher" };
        const course = l.classes.get(item.classId)!.courseId;
        const group = makeupItems(l, now).filter(
          (i) =>
            i.unitTitle === item.unitTitle &&
            i.status === "open" &&
            l.classes.get(i.classId)?.courseId === course &&
            (course !== null || i.classId === item.classId) &&
            mayArrange(caller, l.classes.get(i.classId)!.centerId),
        );
        if (group.length === 0) return { ok: false, reason: "nothing_open" };
        const snap = await snapshot(tx);
        const cls = snap.classes.get(item.classId)!;
        const busy = clashes(snap, now, [
          {
            label: `make-up ${item.unitTitle}`,
            at: new Date(at),
            durationMin: cls.durationMin,
            teacherId,
            centerId: null,
            room: null,
          },
        ]);
        if (busy.length) return { ok: false, reason: "clash", clashes: busy };
        const sid = `mk-${randomUUID().slice(0, 12)}`;
        await tx
          .insertInto("session")
          .values({
            org_id: caller.ctx.orgId,
            id: sid,
            class_id: item.classId,
            title: item.unitTitle,
            at: new Date(at),
            kind: "makeup",
            substitute_id: cls.teacherId === teacherId ? null : teacherId,
            held_by: null,
            replaced_by: null,
            replaces: null,
          })
          .execute();
        for (const i of group) {
          const k = splitItem(i.id)!;
          await tx
            .deleteFrom("makeup_selfstudy")
            .where("missed_session_id", "=", k.missed)
            .where("learner_id", "=", k.learner)
            .execute();
          await tx
            .deleteFrom("makeup_booking")
            .where("missed_session_id", "=", k.missed)
            .where("learner_id", "=", k.learner)
            .execute();
          await tx
            .insertInto("makeup_booking")
            .values({
              org_id: caller.ctx.orgId,
              missed_session_id: k.missed,
              learner_id: k.learner,
              session_id: sid,
              booked_by: caller.ctx.principalId,
            })
            .execute();
        }
        return OK;
      },
    );
  });

  app.secured("POST", "/v1/makeups/:item/self-study", async (caller, req) => {
    const id = (req.params as { item: string }).item;
    await staffWrite(
      caller,
      "POST /v1/makeups/:item/self-study",
      id,
      null,
      async (tx, _l, _item) => {
        const k = splitItem(id)!;
        await tx
          .deleteFrom("makeup_booking")
          .where("missed_session_id", "=", k.missed)
          .where("learner_id", "=", k.learner)
          .execute();
        await tx
          .deleteFrom("makeup_selfstudy")
          .where("missed_session_id", "=", k.missed)
          .where("learner_id", "=", k.learner)
          .execute();
        await tx
          .insertInto("makeup_selfstudy")
          .values({
            org_id: caller.ctx.orgId,
            missed_session_id: k.missed,
            learner_id: k.learner,
            assigned_by: caller.ctx.principalId,
            submitted_at: null,
            note: null,
            returned_note: null,
            confirmed_at: null,
            confirmed_by: null,
          })
          .execute();
        return OK;
      },
    );
  });

  // ── learners & guardians ──
  app.secured("GET", "/v1/me/makeups", async (caller) =>
    caller.tenant(async (tx) => {
      const ids = await ownLearnerIds(tx, caller);
      if (ids.length === 0) return [];
      return makeupItems(await loadLedger(tx), caller.now()).filter((i) =>
        ids.includes(i.learnerId),
      );
    }),
  );

  /** Item write for a learner or a teacher: not_found unless `own(item)`. */
  const itemWrite = (
    caller: Caller,
    route: string,
    id: string,
    body: unknown,
    action: string,
    own: (tx: TenantTx, l: Ledger, item: MakeupItem) => Promise<boolean>,
    run: (tx: TenantTx, item: MakeupItem, now: number) => Promise<MakeupRefusal | null>,
  ) =>
    caller.write<MakeupItemResult>(route, { id, body }, async (tx) => {
      const refuse = (reason: MakeupRefusal) => ({
        status: STATUS[reason],
        body: { ok: false as const, reason },
        audit: { action, resource: { item: id }, outcome: "denied" as const, reason },
      });
      if (!ITEM.test(id) || !splitItem(id)) return refuse("not_found");
      const now = caller.now();
      const l = await loadLedger(tx);
      const item = makeupItems(l, now).find((i) => i.id === id);
      if (!item || !(await own(tx, l, item))) return refuse("not_found");
      const self = l.selfStudies.get(id);
      if (!self) return refuse("not_self_study");
      if (self.confirmedAt) return refuse("already_done");
      const r = await run(tx, item, now);
      if (r) return refuse(r);
      const after = makeupItems(await loadLedger(tx), now).find((i) => i.id === id)!;
      return {
        status: 200,
        body: { ok: true as const, item: after },
        audit: { action, resource: { item: id }, outcome: "allowed" as const, after: body },
      };
    });

  app.secured("POST", "/v1/me/makeups/:item/self-study", async (caller, req) => {
    const id = (req.params as { item: string }).item;
    const note =
      typeof (req.body as { note?: unknown } | null)?.note === "string"
        ? (req.body as { note: string }).note.trim()
        : "";
    await itemWrite(
      caller,
      "POST /v1/me/makeups/:item/self-study",
      id,
      { note },
      "makeup:selfstudy.submit",
      async (tx, _l, item) =>
        caller.ctx.role === "learner" && (await ownLearnerIds(tx, caller)).includes(item.learnerId),
      async (tx, item, now) => {
        if (note.length < 10) return "note_required";
        await tx
          .updateTable("makeup_selfstudy")
          .set({ submitted_at: new Date(now), note: note.slice(0, 2000), returned_note: null })
          .where("missed_session_id", "=", item.missedSessionId)
          .where("learner_id", "=", item.learnerId)
          .execute();
        return null;
      },
    );
  });

  // ── the learner's own class teacher (not a substitute) ──

  app.secured("GET", "/v1/me/makeups/to-confirm", async (caller) =>
    caller.tenant(async (tx) => {
      const me = await myTeacherId(tx, caller);
      if (!me) return [];
      const l = await loadLedger(tx);
      return makeupItems(l, caller.now()).filter(
        (i) => i.status === "to_confirm" && l.classes.get(i.classId)?.teacherId === me,
      );
    }),
  );

  const ownClassTeacher = (caller: Caller) => async (tx: TenantTx, l: Ledger, item: MakeupItem) => {
    const me = await myTeacherId(tx, caller);
    return !!me && l.classes.get(item.classId)?.teacherId === me;
  };

  app.secured("POST", "/v1/makeups/:item/confirm", async (caller, req) => {
    const id = (req.params as { item: string }).item;
    await itemWrite(
      caller,
      "POST /v1/makeups/:item/confirm",
      id,
      null,
      "makeup:selfstudy.confirm",
      ownClassTeacher(caller),
      async (tx, item, now) => {
        if (item.status !== "to_confirm") return "not_submitted";
        await tx
          .updateTable("makeup_selfstudy")
          .set({ confirmed_at: new Date(now), confirmed_by: caller.ctx.principalId })
          .where("missed_session_id", "=", item.missedSessionId)
          .where("learner_id", "=", item.learnerId)
          .execute();
        return null;
      },
    );
  });

  app.secured("POST", "/v1/makeups/:item/return", async (caller, req) => {
    const id = (req.params as { item: string }).item;
    const note =
      typeof (req.body as { note?: unknown } | null)?.note === "string"
        ? (req.body as { note: string }).note.trim()
        : "";
    await itemWrite(
      caller,
      "POST /v1/makeups/:item/return",
      id,
      { note },
      "makeup:selfstudy.return",
      ownClassTeacher(caller),
      async (tx, item) => {
        if (item.status !== "to_confirm") return "not_submitted";
        if (note.length === 0) return "note_required";
        await tx
          .updateTable("makeup_selfstudy")
          .set({ submitted_at: null, returned_note: note.slice(0, 2000) })
          .where("missed_session_id", "=", item.missedSessionId)
          .where("learner_id", "=", item.learnerId)
          .execute();
        return null;
      },
    );
  });
}
