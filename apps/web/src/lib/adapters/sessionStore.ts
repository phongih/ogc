/*
 * P2 · In-memory class schedule (NON-PRODUCTION, synthetic). One source of truth for sessions:
 * attendance, the teacher dashboard and center operations all read it. Seeded from
 * fixtures/attendance; a page reload restores the seed.
 */
import { seedSessions } from "../../fixtures/attendance";
import { classTeachers } from "../../fixtures/teaching";

export interface StoredSession {
  id: string;
  classId: string;
  title: string;
  at: string;
  state: "scheduled" | "cancelled";
  substituteId: string | null;
  replacedBy: string | null;
  replaces: string | null;
}

const SEED_OWNERS = { ...classTeachers };
const sessions = new Map<string, StoredSession>();
let seq = 0;

function reset(): void {
  sessions.clear();
  seq = 0;
  for (const s of seedSessions)
    sessions.set(s.id, {
      id: s.id,
      classId: s.classId,
      title: s.title,
      at: s.at,
      state: "scheduled",
      substituteId: null,
      replacedBy: null,
      replaces: null,
    });
  for (const k of Object.keys(classTeachers)) delete classTeachers[k];
  Object.assign(classTeachers, SEED_OWNERS);
}
reset();

const byTime = (a: StoredSession, b: StoredSession) => Date.parse(a.at) - Date.parse(b.at);

export const sessionStore = {
  reset,
  get: (id: string) => sessions.get(id),
  all: () => [...sessions.values()].sort(byTime),
  forClass: (classId: string) =>
    [...sessions.values()].filter((s) => s.classId === classId).sort(byTime),
  add(
    s: Omit<StoredSession, "id" | "state" | "substituteId" | "replacedBy" | "replaces"> &
      Partial<StoredSession>,
  ): StoredSession {
    const id = s.id ?? `S-${s.classId.slice(-2)}-${++seq}`;
    const row: StoredSession = {
      state: "scheduled",
      substituteId: null,
      replacedBy: null,
      replaces: null,
      ...s,
      id,
    };
    sessions.set(id, row);
    return row;
  },
  update(
    id: string,
    patch: Partial<Omit<StoredSession, "id" | "classId">>,
  ): StoredSession | undefined {
    const cur = sessions.get(id);
    if (!cur) return undefined;
    const next = { ...cur, ...patch };
    sessions.set(id, next);
    return next;
  },
};
