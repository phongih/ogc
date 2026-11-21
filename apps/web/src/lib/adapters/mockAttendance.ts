import type {
  AttendanceMark,
  AttendancePort,
  AttendanceSummaryRow,
  ClassSession,
  RecordAttendanceResult,
  SessionAttendance,
} from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { ABSENCE_STREAK_THRESHOLD, seedSessions } from "../../fixtures/attendance";
import { sessionStore, type StoredSession } from "./sessionStore";
import { withFault } from "./faults";

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

function ownsClass(viewerPersonaId: string, classId: string): boolean {
  const viewer = personaMap[viewerPersonaId];
  const cls = classes.find((c) => c.id === classId);
  return (
    !!viewer?.teacherId &&
    !!cls &&
    classTeachers[classId] === viewer.teacherId &&
    cls.orgId === viewer.orgId
  );
}

// The owner of the class, or this session's substitute — same tenant either way.
function canMarkSession(viewerPersonaId: string, s: StoredSession): boolean {
  if (ownsClass(viewerPersonaId, s.classId)) return true;
  const viewer = personaMap[viewerPersonaId];
  const cls = classes.find((c) => c.id === s.classId);
  return !!viewer?.teacherId && s.substituteId === viewer.teacherId && cls?.orgId === viewer.orgId;
}

export const isMarked = (sessionId: string) => marks.has(sessionId);

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
  return { id: s.id, classId: s.classId, title: s.title, at: s.at, status };
}

function sessionView(s: StoredSession): SessionAttendance {
  const m = marks.get(s.id);
  return {
    session: toSession(s),
    className: classes.find((c) => c.id === s.classId)?.name ?? "Class",
    rows: (rosters[s.classId] ?? []).map((r) => ({
      learnerId: r.learnerId,
      displayName: r.displayName,
      mark: m?.get(r.learnerId) ?? null,
    })),
  };
}

// Chronological marks for one learner in one class (marked sessions only).
function historyFor(classId: string, learnerId: string): AttendanceMark[] {
  return sessionStore
    .forClass(classId)
    .map((s) => marks.get(s.id)?.get(learnerId))
    .filter((x): x is AttendanceMark => !!x);
}

function trailingAbsences(h: readonly AttendanceMark[]): number {
  let n = 0;
  for (let i = h.length - 1; i >= 0 && h[i] === "absent"; i--) n++;
  return n;
}

/**
 * attendance-v1 for the support queue: the learner's longest current absence streak across the
 * given classes, if it reaches the threshold; otherwise null. Callers enforce authorization.
 */
export function absenceStreakFor(learnerId: string, classIds: readonly string[]): number | null {
  const streak = Math.max(0, ...classIds.map((c) => trailingAbsences(historyFor(c, learnerId))));
  return streak >= ABSENCE_STREAK_THRESHOLD ? streak : null;
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
      const roster = new Set((rosters[s.classId] ?? []).map((r) => r.learnerId));
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
