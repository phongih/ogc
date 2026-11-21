import type {
  ClassSchedule,
  OperationsOverview,
  ScheduleRefusal,
  ScheduleResult,
  SchedulePort,
  ScheduledSession,
  TeacherRef,
} from "@ogc/contracts";
import { personaMap, teachers } from "../../fixtures/personas";
import { classTeachers, classes } from "../../fixtures/teaching";
import { sessionStore, type StoredSession } from "./sessionStore";
import { isMarked } from "./mockAttendance";
import { findClashes, slotOf } from "./clashes";
import { withFault } from "./faults";

/*
 * P2 · Center operations — MOCK adapter. NON-PRODUCTION, synthetic, browser memory.
 * Staff only, own tenant only (fail-closed). Owner decisions 21/11: staff manage the schedule and
 * teacher assignment; a cancellation REQUIRES a replacement time for the whole class; sessions
 * that have started or been marked are history and cannot be moved or cancelled.
 */

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

const refuse = (reason: ScheduleRefusal) => latency<ScheduleResult>({ ok: false, reason });
const clash = (clashes: string[]) =>
  latency<ScheduleResult>({ ok: false, reason: "clash", clashes });

function staffOrg(viewerPersonaId: string): string | null {
  const p = personaMap[viewerPersonaId];
  return p?.staff ? p.orgId : null;
}

const teacherRef = (id: string | null | undefined): TeacherRef | null => {
  const t = teachers.find((x) => x.id === id);
  return t ? { id: t.id, name: t.name } : null;
};

function toScheduled(s: StoredSession, now: number): ScheduledSession {
  return {
    id: s.id,
    classId: s.classId,
    title: s.title,
    at: s.at,
    state: s.state,
    kind: s.kind,
    started: Date.parse(s.at) <= now,
    marked: isMarked(s.id),
    substitute: teacherRef(s.substituteId),
    replacedBy: s.replacedBy,
    replaces: s.replaces,
  };
}

function classSchedule(classId: string): ClassSchedule {
  const c = classes.find((x) => x.id === classId)!;
  const now = Date.now();
  return {
    classId,
    className: c.name,
    teacher: teacherRef(classTeachers[classId]),
    learnerCount: c.learnerCount,
    sessions: sessionStore.forClass(classId).map((s) => toScheduled(s, now)),
  };
}

// A class in the staff member's own tenant, or null (fail-closed).
function staffClass(viewer: string, classId: string) {
  const org = staffOrg(viewer);
  const c = classes.find((x) => x.id === classId);
  return org && c && c.orgId === org ? c : null;
}

function staffSession(viewer: string, sessionId: string) {
  const s = sessionStore.get(sessionId);
  return s && staffClass(viewer, s.classId) ? s : null;
}

const future = (iso: string) => Number.isFinite(Date.parse(iso)) && Date.parse(iso) > Date.now();
const isHistory = (s: StoredSession) => Date.parse(s.at) <= Date.now() || isMarked(s.id);

export const mockSchedule: SchedulePort = {
  getOverview: (viewer) =>
    withFault("schedule.getOverview", () => {
      const org = staffOrg(viewer);
      if (!org) return latency<OperationsOverview | null>(null);
      return latency<OperationsOverview>({
        orgId: org,
        teachers: teachers.filter((t) => t.orgId === org).map((t) => ({ id: t.id, name: t.name })),
        classes: classes.filter((c) => c.orgId === org).map((c) => classSchedule(c.id)),
      });
    }),

  reschedule: (viewer, sessionId, newAt) =>
    withFault("schedule.reschedule", () => {
      if (!staffOrg(viewer)) return refuse("not_staff");
      const s = staffSession(viewer, sessionId);
      if (!s) return refuse("not_found");
      if (s.state === "cancelled") return refuse("cancelled");
      if (isHistory(s)) return refuse("already_started");
      if (!future(newAt)) return refuse("in_past");
      const moved = findClashes(
        [{ ...slotOf(s), at: new Date(newAt).toISOString() }],
        new Set([s.id]),
      );
      if (moved.length) return clash(moved);
      sessionStore.update(s.id, { at: new Date(newAt).toISOString() });
      return latency<ScheduleResult>({ ok: true, classSchedule: classSchedule(s.classId) });
    }),

  cancelWithReplacement: (viewer, sessionId, replacementAt) =>
    withFault("schedule.cancelWithReplacement", () => {
      if (!staffOrg(viewer)) return refuse("not_staff");
      const s = staffSession(viewer, sessionId);
      if (!s) return refuse("not_found");
      if (s.state === "cancelled") return refuse("cancelled");
      if (isHistory(s)) return refuse("already_started");
      if (!future(replacementAt)) return refuse("in_past");
      // The whole class keeps the lesson: same title, new time. No learner loses it.
      const replClashes = findClashes(
        [{ ...slotOf(s), at: new Date(replacementAt).toISOString() }],
        new Set([s.id]),
      );
      if (replClashes.length) return clash(replClashes);
      const repl = sessionStore.add({
        classId: s.classId,
        title: s.title,
        at: new Date(replacementAt).toISOString(),
        replaces: s.id,
        kind: s.kind,
        substituteId: s.kind === "makeup" ? s.substituteId : null,
      });
      // Make-up bookings follow the lesson to its new time.
      for (const [itemId, sid] of sessionStore.bookings)
        if (sid === s.id) sessionStore.bookings.set(itemId, repl.id);
      sessionStore.update(s.id, { state: "cancelled", replacedBy: repl.id, substituteId: null });
      return latency<ScheduleResult>({ ok: true, classSchedule: classSchedule(s.classId) });
    }),

  addSession: (viewer, classId, title, at) =>
    withFault("schedule.addSession", () => {
      if (!staffOrg(viewer)) return refuse("not_staff");
      if (!staffClass(viewer, classId)) return refuse("not_found");
      if (!future(at)) return refuse("in_past");
      const name = title.trim() || "Extra session";
      const probe = {
        id: "probe",
        classId,
        title: name,
        at: new Date(at).toISOString(),
        state: "scheduled" as const,
        kind: "regular" as const,
        substituteId: null,
        replacedBy: null,
        replaces: null,
      };
      const extra = findClashes([slotOf(probe)]);
      if (extra.length) return clash(extra);
      sessionStore.add({ classId, title: name, at: new Date(at).toISOString() });
      return latency<ScheduleResult>({ ok: true, classSchedule: classSchedule(classId) });
    }),

  assignTeacher: (viewer, classId, teacherId) =>
    withFault("schedule.assignTeacher", () => {
      const org = staffOrg(viewer);
      if (!org) return refuse("not_staff");
      if (!staffClass(viewer, classId)) return refuse("not_found");
      if (!teachers.some((t) => t.id === teacherId && t.orgId === org))
        return refuse("unknown_teacher");
      // Every future session the class teacher will teach (not those covered by a substitute).
      const now = Date.now();
      const taught = sessionStore
        .forClass(classId)
        .filter(
          (x) =>
            x.state === "scheduled" &&
            Date.parse(x.at) > now &&
            (!x.substituteId || x.substituteId === teacherId),
        );
      const reassign = findClashes(
        taught.map((x) => slotOf(x, teacherId)),
        new Set(taught.map((x) => x.id)),
      );
      if (reassign.length) return clash(reassign);
      classTeachers[classId] = teacherId;
      // A substitute who is now the class's own teacher is no longer a substitute.
      for (const s of sessionStore.forClass(classId))
        if (s.substituteId === teacherId) sessionStore.update(s.id, { substituteId: null });
      return latency<ScheduleResult>({ ok: true, classSchedule: classSchedule(classId) });
    }),

  setSubstitute: (viewer, sessionId, teacherId) =>
    withFault("schedule.setSubstitute", () => {
      const org = staffOrg(viewer);
      if (!org) return refuse("not_staff");
      const s = staffSession(viewer, sessionId);
      if (!s) return refuse("not_found");
      if (s.state === "cancelled") return refuse("cancelled");
      if (isMarked(s.id)) return refuse("already_started"); // marked = history
      if (teacherId !== null) {
        if (!teachers.some((t) => t.id === teacherId && t.orgId === org))
          return refuse("unknown_teacher");
        if (classTeachers[s.classId] === teacherId) return refuse("same_teacher");
      }
      if (teacherId !== null) {
        const sub = findClashes([slotOf(s, teacherId)], new Set([s.id]));
        if (sub.length) return clash(sub);
      }
      sessionStore.update(s.id, { substituteId: teacherId });
      return latency<ScheduleResult>({ ok: true, classSchedule: classSchedule(s.classId) });
    }),
};
