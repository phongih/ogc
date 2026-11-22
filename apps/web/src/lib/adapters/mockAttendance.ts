import type { IiosGrantedContext } from "@ogc/contracts";
import { refill, registerPersistent } from "./persist";
import type {
  AttendanceMark,
  AttendancePort,
  AttendanceSummaryRow,
  ClassSession,
  RecordAttendanceResult,
  SessionAttendance,
} from "@ogc/contracts";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { ABSENCE_STREAK_THRESHOLD, seedSessions } from "../../fixtures/attendance";
import { sessionStore, type StoredSession } from "./sessionStore";
import { withFault } from "./faults";
import { teacherIdOf } from "./viewer";
import { allows } from "./accessPolicy";

/*
 * P2 · Session attendance — MOCK adapter. NON-PRODUCTION, synthetic, in browser memory
 * (a reload restores the seeded history). Fail-closed: only the teacher who OWNS the class, in
 * the class's own tenant, can read or mark it — or, for a single session, the substitute center
 * staff assigned to it. A session can be marked only once it has started and is not cancelled;
 * a later save replaces the earlier marks for that session. Sessions come from sessionStore.
 */

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// sessionId → learnerId → mark. Seeded once from fixtures.
const marks = new Map<string, Map<string, AttendanceMark>>();
function resetAttendance(): void {
  sessionStore.reset();
  marks.clear();
  for (const s of seedSessions)
    if (s.seededMarks) marks.set(s.id, new Map(Object.entries(s.seededMarks)));
}
resetAttendance();
export const __resetAttendanceForTests = resetAttendance;

function ownsClass(viewer: IiosGrantedContext, classId: string): boolean {
  const teacherId = teacherIdOf(viewer);
  const cls = classes.find((c) => c.id === classId);
  return !!teacherId && !!cls && classTeachers[classId] === teacherId && cls.orgId === viewer.orgId;
}

// The owner of the class, or this session's substitute — same tenant either way.
// An access policy can narrow this further (e.g. own classes only, not as a substitute).
function canMarkSession(viewer: IiosGrantedContext, s: StoredSession): boolean {
  if (ownsClass(viewer, s.classId))
    return allows(viewer, "attendance:mark", { sessionRole: "owner" });
  const teacherId = teacherIdOf(viewer);
  const cls = classes.find((c) => c.id === s.classId);
  return (
    !!teacherId &&
    s.substituteId === teacherId &&
    cls?.orgId === viewer.orgId &&
    allows(viewer, "attendance:mark", { sessionRole: "substitute" })
  );
}

export const isMarked = (sessionId: string) => marks.has(sessionId);
export const markOf = (sessionId: string, learnerId: string): AttendanceMark | null =>
  marks.get(sessionId)?.get(learnerId) ?? null;
/** All recorded marks (read-only view) — the make-up ledger derives its items from these. */
export const allMarks = (): ReadonlyMap<string, ReadonlyMap<string, AttendanceMark>> => marks;

const onRoster = (classId: string, learnerId: string) =>
  (rosters[classId] ?? []).some((r) => r.learnerId === learnerId);

/**
 * P2 · a make-up item is live while the learner is still marked ABSENT at a regular session of
 * their own class. Correcting the absence removes the item (and its booking stops counting).
 */
export function makeupItemLive(itemId: string): boolean {
  const [sessionId, learnerId] = itemId.split("::");
  const s = sessionStore.get(sessionId);
  return (
    !!s &&
    s.kind === "regular" &&
    onRoster(s.classId, learnerId) &&
    markOf(sessionId, learnerId) === "absent"
  );
}

function learnerName(learnerId: string): string {
  for (const list of Object.values(rosters)) {
    const row = list.find((r) => r.learnerId === learnerId);
    if (row) return row.displayName;
  }
  return "Learner";
}

// Guests booked into this session to make up a missed unit (live items only).
function guestsOf(sessionId: string): { learnerId: string; fromClassId: string }[] {
  const out: { learnerId: string; fromClassId: string }[] = [];
  for (const [itemId, sid] of sessionStore.bookings) {
    if (sid !== sessionId || !makeupItemLive(itemId)) continue;
    const [missed, learnerId] = itemId.split("::");
    out.push({ learnerId, fromClassId: sessionStore.get(missed)!.classId });
  }
  return out;
}

const started = (s: StoredSession, nowMs: number) => Date.parse(s.at) <= nowMs;

function toSession(s: StoredSession, nowMs = Date.now()): ClassSession {
  const status =
    s.state === "cancelled"
      ? "cancelled"
      : !started(s, nowMs)
        ? "upcoming"
        : marks.has(s.id)
          ? "marked"
          : "to_mark";
  return { id: s.id, classId: s.classId, title: s.title, at: s.at, status, kind: s.kind };
}

function sessionView(s: StoredSession): SessionAttendance {
  const m = marks.get(s.id);
  return {
    session: toSession(s),
    className: classes.find((c) => c.id === s.classId)?.name ?? "Class",
    rows: [
      // A make-up session holds booked guests only; a regular one, the class roster + guests.
      ...(s.kind === "makeup" ? [] : (rosters[s.classId] ?? [])).map((r) => ({
        learnerId: r.learnerId,
        displayName: r.displayName,
        mark: m?.get(r.learnerId) ?? null,
        makeupFor: null,
      })),
      ...guestsOf(s.id).map((g) => ({
        learnerId: g.learnerId,
        displayName: learnerName(g.learnerId),
        mark: m?.get(g.learnerId) ?? null,
        makeupFor: classes.find((c) => c.id === g.fromClassId)?.name ?? "another class",
      })),
    ],
  };
}

// Chronological marks for one learner in their OWN class: regular sessions only (a guest's marks
// in another class, and make-up sessions, are make-up evidence — not this class's attendance).
function historyFor(classId: string, learnerId: string): AttendanceMark[] {
  if (!onRoster(classId, learnerId)) return [];
  return sessionStore
    .forClass(classId)
    .filter((s) => s.kind === "regular")
    .map((s) => marks.get(s.id)?.get(learnerId))
    .filter((x): x is AttendanceMark => !!x);
}

/** The learner's marks in one class's regular sessions, oldest first (callers authorize). */
export const attendanceHistoryFor = historyFor;

function trailingAbsences(h: readonly AttendanceMark[]): number {
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i] === "absent"; i--) n++;
  return n;
}

/**
 * attendance-v1 for the support queue: the learner's longest current absence streak across the
 * given classes, if it reaches the threshold; otherwise null. Callers enforce authorization.
 */
export function absenceStreakFor(
  learnerId: string,
  classIds: readonly string[],
  threshold: number = ABSENCE_STREAK_THRESHOLD, // Decision Engine rule "absent N in a row"
): number | null {
  const streak = Math.max(0, ...classIds.map((c) => trailingAbsences(historyFor(c, learnerId))));
  return streak >= threshold ? streak : null;
}

export const mockAttendance: AttendancePort = {
  listClassSessions: (viewer, classId) =>
    withFault("attendance.listClassSessions", () => {
      if (!ownsClass(viewer, classId)) return latency<ClassSession[] | null>(null);
      const now = Date.now();
      return latency(
        sessionStore
          .forClass(classId)
          .reverse() // newest first
          .map((s) => toSession(s, now)),
      );
    }),

  getSessionAttendance: (viewer, sessionId) =>
    withFault("attendance.getSessionAttendance", () => {
      const s = sessionStore.get(sessionId);
      if (!s || !canMarkSession(viewer, s)) return latency<SessionAttendance | null>(null);
      return latency(sessionView(s));
    }),

  recordAttendance: (viewer, sessionId, input) =>
    withFault("attendance.recordAttendance", () => {
      const fail = (reason: Extract<RecordAttendanceResult, { ok: false }>["reason"]) =>
        latency<RecordAttendanceResult>({ ok: false, reason });
      const s = sessionStore.get(sessionId);
      if (!s || !canMarkSession(viewer, s)) return fail("not_found");
      if (s.state === "cancelled") return fail("cancelled");
      if (!started(s, Date.now())) return fail("not_started");
      const roster = new Set(sessionView(s).rows.map((r) => r.learnerId)); // roster + guests
      const next = new Map<string, AttendanceMark>();
      for (const m of input.marks) {
        if (!roster.has(m.learnerId)) return fail("not_on_roster");
        next.set(m.learnerId, m.mark);
      }
      if (next.size !== roster.size) return fail("incomplete"); // every learner, every time
      marks.set(s.id, next); // latest save replaces the earlier one
      return latency<RecordAttendanceResult>({ ok: true, attendance: sessionView(s) });
    }),

  getClassSummary: (viewer, classId) =>
    withFault("attendance.getClassSummary", () => {
      if (!ownsClass(viewer, classId)) return latency<AttendanceSummaryRow[] | null>(null);
      return latency(
        (rosters[classId] ?? []).map((r) => {
          const h = historyFor(classId, r.learnerId);
          const count = (k: AttendanceMark) => h.filter((x) => x === k).length;
          const present = count("present");
          const late = count("late");
          return {
            learnerId: r.learnerId,
            displayName: r.displayName,
            present,
            late,
            absent: count("absent"),
            marked: h.length,
            attendedPct: h.length ? Math.round(((present + late) / h.length) * 100) : null,
            absentStreak: trailingAbsences(h),
          };
        }),
      );
    }),

  listToMark: (viewer) =>
    withFault("attendance.listToMark", () => {
      const now = Date.now();
      return latency(
        sessionStore
          .all()
          .filter(
            (s) =>
              s.state === "scheduled" &&
              canMarkSession(viewer, s) &&
              started(s, now) &&
              !marks.has(s.id),
          )
          .map((s) => toSession(s, now)),
      );
    }),
};

registerPersistent("attendance", {
  dump: () => ({ marks }),
  load: (raw) => refill(marks, (raw as { marks?: unknown }).marks),
});
