import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";

/*
 * P2 · Session attendance — ADDITIVE, SYNTHETIC, mock adapter only.
 *
 * Owner decisions (21/11):
 *  - the owning teacher marks each learner Present / Late / Absent per session;
 *  - only a session that has STARTED can be marked; a marked session can be corrected, and the
 *    latest save replaces the earlier one;
 *  - the class attendance summary is computed from marked sessions only (no estimates);
 *  - repeated absence feeds the "needs support" queue as its own, labelled source
 *    (`attendance`); it never changes a skill level.
 */

export const AttendanceMark = z.enum(["present", "late", "absent"]);
export type AttendanceMark = z.infer<typeof AttendanceMark>;

export const ClassSessionStatus = z.enum(["upcoming", "to_mark", "marked", "cancelled"]);
export type ClassSessionStatus = z.infer<typeof ClassSessionStatus>;

export const ClassSession = z.object({
  id: z.string().min(1),
  classId: Id,
  title: z.string().min(1),
  at: z.string(), // ISO instant
  status: ClassSessionStatus,
  kind: z.enum(["regular", "makeup"]).optional(), // P2: a make-up session (guests only)
});
export type ClassSession = z.infer<typeof ClassSession>;

export const SessionAttendanceRow = z.object({
  learnerId: Id,
  displayName: z.string().min(1),
  mark: AttendanceMark.nullable(), // null = not marked yet
  makeupFor: z.string().nullable().optional(), // P2: a guest making up a missed unit ("A2 Morning — Mon/Wed")
});
export type SessionAttendanceRow = z.infer<typeof SessionAttendanceRow>;

export const SessionAttendance = z.object({
  session: ClassSession,
  className: z.string().min(1),
  rows: z.array(SessionAttendanceRow),
});
export type SessionAttendance = z.infer<typeof SessionAttendance>;

export const AttendanceSummaryRow = z.object({
  learnerId: Id,
  displayName: z.string().min(1),
  present: z.number().int().nonnegative(),
  late: z.number().int().nonnegative(),
  absent: z.number().int().nonnegative(),
  marked: z.number().int().nonnegative(), // sessions with a mark for this learner
  attendedPct: z.number().min(0).max(100).nullable(), // (present + late) / marked; null if none
  absentStreak: z.number().int().nonnegative(), // consecutive absences up to the latest marked session
});
export type AttendanceSummaryRow = z.infer<typeof AttendanceSummaryRow>;

export const RecordAttendanceInput = z.object({
  marks: z.array(z.object({ learnerId: Id, mark: AttendanceMark })).min(1),
});
export type RecordAttendanceInput = z.infer<typeof RecordAttendanceInput>;

export const RecordAttendanceResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), attendance: SessionAttendance }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["not_found", "not_started", "incomplete", "not_on_roster", "cancelled"]),
  }),
]);
export type RecordAttendanceResult = z.infer<typeof RecordAttendanceResult>;

// Owning teacher + same tenant (or, for one session, its assigned substitute); everyone else gets
// null / not_found (fail-closed).
export interface AttendancePort {
  listClassSessions(viewer: IiosGrantedContext, classId: string): Promise<ClassSession[] | null>;
  getSessionAttendance(
    viewer: IiosGrantedContext,
    sessionId: string,
  ): Promise<SessionAttendance | null>;
  recordAttendance(
    viewer: IiosGrantedContext,
    sessionId: string,
    input: RecordAttendanceInput,
  ): Promise<RecordAttendanceResult>;
  getClassSummary(
    viewer: IiosGrantedContext,
    classId: string,
  ): Promise<AttendanceSummaryRow[] | null>;
  // Sessions that have started but are not marked yet: the viewer's own classes, plus sessions the
  // viewer substitutes for.
  listToMark(viewer: IiosGrantedContext): Promise<ClassSession[]>;
}
