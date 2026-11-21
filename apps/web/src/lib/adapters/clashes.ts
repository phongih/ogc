/*
 * P2 · Double-booking check (owner, 21/11: Ben was given two classes at Tue 18:00 by the
 * wizard). A teacher cannot teach two sessions that overlap in time, and a room cannot hold two
 * sessions at once. Checked wherever the schedule is created or changed: center setup,
 * reschedule, cancel-with-replacement, extra session, class teacher, substitute, make-up session.
 * Only future scheduled sessions count; cancelled ones never clash. Messages are plain words.
 */
import { classTeachers, classes } from "../../fixtures/teaching";
import { centers } from "../../fixtures/directory";
import { teacherName } from "../../fixtures/personas";
import { formatCenterDateTime } from "../centerTime";
import { sessionStore, type StoredSession } from "./sessionStore";

export interface Slot {
  label: string; // what the slot is, for messages ("A2 Evening — Tue/Thu")
  at: string;
  durationMin: number;
  teacherId: string | null;
  centerId: string | null;
  room: string | null;
  sessionId?: string;
}

const MAX_MESSAGES = 5;
const className = (id: string) => classes.find((c) => c.id === id)?.name ?? "another class";
const centerName = (id: string | null) => centers.find((c) => c.id === id)?.name ?? "this center";
export const teacherOfSession = (s: StoredSession): string | null =>
  s.substituteId ?? classTeachers[s.classId] ?? null;

export function slotOf(s: StoredSession, teacherId: string | null = teacherOfSession(s)): Slot {
  const meta = sessionStore.classMeta(s.classId);
  return {
    label: className(s.classId),
    at: s.at,
    durationMin: meta.durationMin,
    teacherId,
    centerId: classes.find((c) => c.id === s.classId)?.centerId ?? null,
    room: meta.room,
    sessionId: s.id,
  };
}

const overlap = (a: Slot, b: Slot) => {
  const a0 = Date.parse(a.at);
  const b0 = Date.parse(b.at);
  return a0 < b0 + b.durationMin * 60_000 && b0 < a0 + a.durationMin * 60_000;
};

function why(cand: Slot, other: Slot): string | null {
  if (!overlap(cand, other)) return null;
  if (cand.teacherId && cand.teacherId === other.teacherId)
    return `${teacherName(cand.teacherId) ?? "This teacher"} already teaches ${other.label} on ${formatCenterDateTime(other.at)}`;
  if (cand.room && cand.room === other.room && cand.centerId && cand.centerId === other.centerId)
    return `${cand.room} at ${centerName(cand.centerId)} is already used by ${other.label} on ${formatCenterDateTime(other.at)}`;
  return null;
}

/**
 * Clashes the candidate slots would create — against the live schedule (minus `exclude`, the
 * sessions being moved or reassigned) and against each other. Empty = fine.
 */
export function findClashes(
  cands: readonly Slot[],
  exclude: ReadonlySet<string> = new Set(),
): string[] {
  const now = Date.now();
  const busy = sessionStore
    .all()
    .filter(
      (s) => s.state === "scheduled" && !exclude.has(s.id) && Date.parse(s.at) + 4 * 3600_000 > now,
    )
    .map((s) => slotOf(s));
  const out = new Set<string>();
  cands.forEach((c, i) => {
    for (const b of busy) {
      const m = why(c, b);
      if (m) out.add(m);
    }
    for (const other of cands.slice(i + 1)) {
      const m = why(other, c);
      if (m) out.add(m);
    }
  });
  const all = [...out];
  return all.length > MAX_MESSAGES
    ? [...all.slice(0, MAX_MESSAGES), `…and ${all.length - MAX_MESSAGES} more`]
    : all;
}
