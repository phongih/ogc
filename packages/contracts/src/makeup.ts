import { z } from "zod";
import { Id } from "./common.js";

/*
 * P2 · Make-up ledger — "no learner loses a lesson". ADDITIVE, SYNTHETIC, mock adapter only.
 *
 * Owner decisions (21/11):
 *  - every ABSENT mark in a learner's own class opens a make-up item for that unit; it never
 *    disappears until the learner is marked present or late at a make-up (or the absence itself
 *    is corrected by the teacher);
 *  - ways to make up: join another class's session of the SAME unit, a separate make-up session
 *    staff open for the learners missing that unit, or SELF-STUDY that the learner's own class
 *    teacher confirms (slice 4) — self-study counts only once the teacher confirms;
 *  - the learner (and a linked guardian, read-only) see their own make-ups;
 *  - deadline 14 days after the missed session; overdue items go to the top of staff's list.
 */

export const MAKEUP_DEADLINE_DAYS = 14;

// open: nothing arranged (or the last arrangement failed) · booked: arranged, not yet attended /
// submitted · to_confirm: self-study submitted, waiting for the teacher · done.
export const MakeupStatus = z.enum(["open", "booked", "to_confirm", "done"]);
export type MakeupStatus = z.infer<typeof MakeupStatus>;

export const SelfStudy = z.object({
  submittedAt: z.string().nullable(),
  note: z.string().nullable(), // what the learner says they studied
  returnedNote: z.string().nullable(), // teacher sent it back with this note
  confirmedAt: z.string().nullable(),
});
export type SelfStudy = z.infer<typeof SelfStudy>;

export const MakeupBooking = z.object({
  kind: z.enum(["join", "makeup", "selfstudy"]), // another class's session, a make-up session, or self-study
  sessionId: z.string().nullable(), // null for self-study
  className: z.string().nullable(),
  at: z.string().nullable(),
  teacherName: z.string().nullable(), // self-study: the class teacher who confirms
  selfStudy: SelfStudy.nullable(),
});
export type MakeupBooking = z.infer<typeof MakeupBooking>;

export const MakeupItem = z.object({
  id: z.string().min(1), // `${missedSessionId}::${learnerId}`
  learnerId: Id,
  learnerName: z.string().min(1),
  classId: Id,
  className: z.string().min(1),
  unitTitle: z.string().min(1),
  missedSessionId: z.string().min(1),
  missedAt: z.string(),
  dueAt: z.string(),
  status: MakeupStatus,
  overdue: z.boolean(), // not done and past dueAt
  missedMakeup: z.boolean(), // was absent from the last booked make-up too
  booking: MakeupBooking.nullable(),
});
export type MakeupItem = z.infer<typeof MakeupItem>;

export const MakeupBoard = z.object({
  items: z.array(MakeupItem), // overdue first, then open, booked, done
  counts: z.object({
    open: z.number().int().nonnegative(),
    booked: z.number().int().nonnegative(),
    toConfirm: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    overdue: z.number().int().nonnegative(),
  }),
});
export type MakeupBoard = z.infer<typeof MakeupBoard>;

export const MakeupOption = z.object({
  sessionId: z.string().min(1),
  kind: z.enum(["join", "makeup"]),
  className: z.string().min(1),
  title: z.string().min(1),
  at: z.string(),
  teacherName: z.string().nullable(),
});
export type MakeupOption = z.infer<typeof MakeupOption>;

export const MakeupRefusal = z.enum([
  "not_staff",
  "not_found",
  "already_done",
  "not_an_option",
  "in_past",
  "unknown_teacher",
  "nothing_open",
  "not_self_study", // the item is not arranged as self-study
  "not_submitted", // nothing to confirm yet
  "note_required",
  "clash", // the chosen teacher is already busy then — see `clashes`
]);
export type MakeupRefusal = z.infer<typeof MakeupRefusal>;

export const MakeupResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), board: MakeupBoard }),
  z.object({
    ok: z.literal(false),
    reason: MakeupRefusal,
    clashes: z.array(z.string()).optional(),
  }),
]);
export type MakeupResult = z.infer<typeof MakeupResult>;

// Staff methods: staff only, own tenant (fail-closed: null / not_staff / not_found).
export interface MakeupPort {
  getBoard(viewerPersonaId: string): Promise<MakeupBoard | null>;
  listOptions(viewerPersonaId: string, itemId: string): Promise<MakeupOption[] | null>;
  book(viewerPersonaId: string, itemId: string, sessionId: string): Promise<MakeupResult>;
  // Opens one make-up session for a unit and books every learner still missing that unit into it.
  openMakeupSession(
    viewerPersonaId: string,
    itemId: string,
    at: string,
    teacherId: string,
  ): Promise<MakeupResult>;
  assignSelfStudy(viewerPersonaId: string, itemId: string): Promise<MakeupResult>;

  // Learner (own items) and guardian (pre-established links only, read-only). Others: [].
  listMine(viewerPersonaId: string): Promise<MakeupItem[]>;
  submitSelfStudy(viewerPersonaId: string, itemId: string, note: string): Promise<MakeupItemResult>;

  // The learner's own class teacher (same tenant): self-study waiting for confirmation.
  listToConfirm(viewerPersonaId: string): Promise<MakeupItem[]>;
  confirmSelfStudy(viewerPersonaId: string, itemId: string): Promise<MakeupItemResult>;
  returnSelfStudy(viewerPersonaId: string, itemId: string, note: string): Promise<MakeupItemResult>;
}

export const MakeupItemResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), item: MakeupItem }),
  z.object({ ok: z.literal(false), reason: MakeupRefusal }),
]);
export type MakeupItemResult = z.infer<typeof MakeupItemResult>;
