import { z } from "zod";
import { Id } from "./common.js";

/*
 * P2 · Center operations: class schedule and teacher assignment — ADDITIVE, SYNTHETIC, mock only.
 *
 * Owner decisions (21/11):
 *  - center STAFF manage the schedule (reschedule / cancel / add a session) and assign teachers
 *    (the class's own teacher, and a substitute for a single session); teachers mark attendance
 *    and see their schedule;
 *  - cancelling a session REQUIRES a replacement date for the whole class, so no learner loses
 *    the lesson; a session that has started or been marked cannot be moved or cancelled.
 */

export const TeacherRef = z.object({ id: Id, name: z.string().min(1) });
export type TeacherRef = z.infer<typeof TeacherRef>;

export const ScheduledSessionState = z.enum(["scheduled", "cancelled"]);
export type ScheduledSessionState = z.infer<typeof ScheduledSessionState>;

export const ScheduledSession = z.object({
  id: z.string().min(1),
  classId: Id,
  title: z.string().min(1),
  at: z.string(), // ISO instant
  state: ScheduledSessionState,
  kind: z.enum(["regular", "makeup"]), // P2: a make-up session (booked guests only)
  started: z.boolean(),
  marked: z.boolean(),
  substitute: TeacherRef.nullable(), // teaches (and marks) this one session instead of the owner
  replacedBy: z.string().nullable(), // cancelled → the replacement session id
  replaces: z.string().nullable(), // replacement → the cancelled session id
});
export type ScheduledSession = z.infer<typeof ScheduledSession>;

export const ClassSchedule = z.object({
  classId: Id,
  className: z.string().min(1),
  centerId: z.string(), // P2: classes are grouped by center on Center operations
  centerName: z.string(),
  teacher: TeacherRef.nullable(),
  learnerCount: z.number().int().nonnegative(),
  sessions: z.array(ScheduledSession), // chronological
});
export type ClassSchedule = z.infer<typeof ClassSchedule>;

export const OperationsOverview = z.object({
  orgId: Id,
  teachers: z.array(TeacherRef),
  classes: z.array(ClassSchedule),
});
export type OperationsOverview = z.infer<typeof OperationsOverview>;

export const ScheduleRefusal = z.enum([
  "not_found", // unknown, or not this staff member's tenant (fail-closed)
  "not_staff",
  "in_past", // the new / replacement time is not in the future
  "already_started", // started or marked sessions are history — not moved or cancelled
  "cancelled", // already cancelled
  "unknown_teacher",
  "same_teacher", // substitute = the class's own teacher
  "clash", // the teacher (or room) is already busy then — see `clashes`
]);
export type ScheduleRefusal = z.infer<typeof ScheduleRefusal>;

export const ScheduleResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), classSchedule: ClassSchedule }),
  z.object({
    ok: z.literal(false),
    reason: ScheduleRefusal,
    clashes: z.array(z.string()).optional(),
  }),
]);
export type ScheduleResult = z.infer<typeof ScheduleResult>;

export interface SchedulePort {
  getOverview(viewerPersonaId: string): Promise<OperationsOverview | null>; // staff only
  reschedule(viewerPersonaId: string, sessionId: string, newAt: string): Promise<ScheduleResult>;
  // Cancel REQUIRES a replacement time: a new session with the same title is created for the class.
  cancelWithReplacement(
    viewerPersonaId: string,
    sessionId: string,
    replacementAt: string,
  ): Promise<ScheduleResult>;
  addSession(
    viewerPersonaId: string,
    classId: string,
    title: string,
    at: string,
  ): Promise<ScheduleResult>;
  assignTeacher(
    viewerPersonaId: string,
    classId: string,
    teacherId: string,
  ): Promise<ScheduleResult>;
  setSubstitute(
    viewerPersonaId: string,
    sessionId: string,
    teacherId: string | null,
  ): Promise<ScheduleResult>;
}
