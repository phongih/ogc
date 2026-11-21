import type {
  MakeupBoard,
  MakeupBooking,
  MakeupItem,
  MakeupOption,
  MakeupPort,
  MakeupRefusal,
  MakeupResult,
} from "@ogc/contracts";
import { MAKEUP_DEADLINE_DAYS } from "@ogc/contracts";
import { personaMap, teacherName, teachers } from "../../fixtures/personas";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { sessionStore, type StoredSession } from "./sessionStore";
import { allMarks, makeupItemLive, markOf } from "./mockAttendance";
import { withFault } from "./faults";

/*
 * P2 · Make-up ledger — MOCK adapter. NON-PRODUCTION, synthetic, browser memory.
 * "No learner loses a lesson" (owner, 21/11): items are DERIVED from attendance — every absent
 * mark at a regular session of the learner's own class is an item — so none can be forgotten or
 * deleted by hand. An item closes only when the learner is marked present/late at the booked
 * make-up. Staff only, own tenant only (fail-closed).
 */

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
const refuse = (reason: MakeupRefusal) => latency<MakeupResult>({ ok: false, reason });
const DAY_MS = 86_400_000;

function staffOrg(viewer: string): string | null {
  const p = personaMap[viewer];
  return p?.staff ? p.orgId : null;
}
const className = (id: string) => classes.find((c) => c.id === id)?.name ?? "Class";
const classOrg = (id: string) => classes.find((c) => c.id === id)?.orgId;
const learnerName = (classId: string, learnerId: string) =>
  rosters[classId]?.find((r) => r.learnerId === learnerId)?.displayName ?? "Learner";
const sessionTeacher = (s: StoredSession) =>
  teacherName(s.substituteId ?? classTeachers[s.classId]);

function bookingOf(s: StoredSession, fromClassId: string): MakeupBooking {
  return {
    sessionId: s.id,
    kind: s.kind === "makeup" || s.classId === fromClassId ? "makeup" : "join",
    className: className(s.classId),
    at: s.at,
    teacherName: sessionTeacher(s),
  };
}

function itemFor(missed: StoredSession, learnerId: string, now: number): MakeupItem {
  const id = `${missed.id}::${learnerId}`;
  const due = Date.parse(missed.at) + MAKEUP_DEADLINE_DAYS * DAY_MS;
  const bookedId = sessionStore.bookings.get(id);
  const booked = bookedId ? sessionStore.get(bookedId) : undefined;
  const mark = booked ? markOf(booked.id, learnerId) : null;
  const status = !booked || mark === "absent" ? "open" : mark ? "done" : "booked";
  return {
    id,
    learnerId,
    learnerName: learnerName(missed.classId, learnerId),
    classId: missed.classId,
    className: className(missed.classId),
    unitTitle: missed.title,
    missedSessionId: missed.id,
    missedAt: missed.at,
    dueAt: new Date(due).toISOString(),
    status,
    overdue: status !== "done" && now > due,
    missedMakeup: mark === "absent",
    booking: booked ? bookingOf(booked, missed.classId) : null,
  };
}

const RANK = (i: MakeupItem) =>
  i.overdue ? 0 : i.status === "open" ? 1 : i.status === "booked" ? 2 : 3;

/** Every live make-up item in a tenant (derived from attendance). Exported for later slices. */
export function makeupItems(orgId: string, now = Date.now()): MakeupItem[] {
  const out: MakeupItem[] = [];
  for (const [sessionId, m] of allMarks()) {
    const s = sessionStore.get(sessionId);
    if (!s || s.kind !== "regular" || classOrg(s.classId) !== orgId) continue;
    for (const [learnerId, mark] of m)
      if (mark === "absent" && makeupItemLive(`${sessionId}::${learnerId}`))
        out.push(itemFor(s, learnerId, now));
  }
  return out.sort((a, b) => RANK(a) - RANK(b) || Date.parse(a.dueAt) - Date.parse(b.dueAt));
}

function board(orgId: string): MakeupBoard {
  const items = makeupItems(orgId);
  const count = (f: (i: MakeupItem) => boolean) => items.filter(f).length;
  return {
    items,
    counts: {
      open: count((i) => i.status === "open"),
      booked: count((i) => i.status === "booked"),
      done: count((i) => i.status === "done"),
      overdue: count((i) => i.overdue),
    },
  };
}

function findItem(orgId: string, itemId: string): MakeupItem | undefined {
  return makeupItems(orgId).find((i) => i.id === itemId);
}

// Same unit, not started, scheduled: another class of the same course, or a make-up session.
function optionsFor(orgId: string, item: MakeupItem): StoredSession[] {
  const course = classes.find((c) => c.id === item.classId)?.courseId;
  const now = Date.now();
  return sessionStore
    .all()
    .filter(
      (s) =>
        s.state === "scheduled" &&
        Date.parse(s.at) > now &&
        s.title === item.unitTitle &&
        classOrg(s.classId) === orgId &&
        classes.find((c) => c.id === s.classId)?.courseId === course &&
        (s.kind === "makeup" || s.classId !== item.classId) &&
        s.id !== item.booking?.sessionId,
    );
}

export const mockMakeup: MakeupPort = {
  getBoard: (viewer) =>
    withFault("makeup.getBoard", () => {
      const org = staffOrg(viewer);
      return latency<MakeupBoard | null>(org ? board(org) : null);
    }),

  listOptions: (viewer, itemId) =>
    withFault("makeup.listOptions", () => {
      const org = staffOrg(viewer);
      const item = org ? findItem(org, itemId) : undefined;
      if (!org || !item) return latency<MakeupOption[] | null>(null);
      return latency<MakeupOption[]>(
        optionsFor(org, item).map((s) => ({
          sessionId: s.id,
          kind: s.kind === "makeup" ? "makeup" : "join",
          className: className(s.classId),
          title: s.title,
          at: s.at,
          teacherName: sessionTeacher(s),
        })),
      );
    }),

  book: (viewer, itemId, sessionId) =>
    withFault("makeup.book", () => {
      const org = staffOrg(viewer);
      if (!org) return refuse("not_staff");
      const item = findItem(org, itemId);
      if (!item) return refuse("not_found");
      if (item.status === "done") return refuse("already_done");
      if (!optionsFor(org, item).some((s) => s.id === sessionId)) return refuse("not_an_option");
      sessionStore.bookings.set(itemId, sessionId);
      return latency<MakeupResult>({ ok: true, board: board(org) });
    }),

  openMakeupSession: (viewer, itemId, at, teacherId) =>
    withFault("makeup.openMakeupSession", () => {
      const org = staffOrg(viewer);
      if (!org) return refuse("not_staff");
      const item = findItem(org, itemId);
      if (!item) return refuse("not_found");
      if (item.status === "done") return refuse("already_done");
      if (!(Date.parse(at) > Date.now())) return refuse("in_past");
      if (!teachers.some((t) => t.id === teacherId && t.orgId === org))
        return refuse("unknown_teacher");
      // Everyone in the tenant still missing this unit (not done, not already booked elsewhere).
      const course = classes.find((c) => c.id === item.classId)?.courseId;
      const group = makeupItems(org).filter(
        (i) =>
          i.unitTitle === item.unitTitle &&
          i.status === "open" &&
          classes.find((c) => c.id === i.classId)?.courseId === course,
      );
      if (group.length === 0) return refuse("nothing_open");
      const s = sessionStore.add({
        classId: item.classId,
        title: item.unitTitle,
        at: new Date(at).toISOString(),
        kind: "makeup",
        substituteId: classTeachers[item.classId] === teacherId ? null : teacherId,
      });
      for (const i of group) sessionStore.bookings.set(i.id, s.id);
      return latency<MakeupResult>({ ok: true, board: board(org) });
    }),
};
