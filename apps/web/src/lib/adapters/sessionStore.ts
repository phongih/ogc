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
  kind: "regular" | "makeup"; // P2: a make-up session holds booked guests only
  substituteId: string | null;
  replacedBy: string | null;
  replaces: string | null;
}

const SEED_OWNERS = { ...classTeachers };
const sessions = new Map<string, StoredSession>();
// P2 · make-up bookings: make-up item id (`${missedSessionId}::${learnerId}`) → session id.
const bookings = new Map<string, string>();
// P2 · self-study make-ups (item id → record). An item is EITHER booked into a session OR self-study.
export interface SelfStudyRecord {
  submittedAt: string | null;
  note: string | null;
  returnedNote: string | null;
  confirmedAt: string | null;
}
const selfStudies = new Map<string, SelfStudyRecord>();
let seq = 0;

function reset(): void {
  sessions.clear();
  bookings.clear();
  selfStudies.clear();
  seq = 0;
  for (const s of seedSessions)
    sessions.set(s.id, {
      id: s.id,
      classId: s.classId,
      title: s.title,
      at: s.at,
      state: "scheduled",
      kind: "regular",
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
  bookings,
  selfStudies,
  get: (id: string) => sessions.get(id),
  /** Where a session lives now: follows cancel-with-replacement to the session that replaced it. */
  liveAt(id: string): string | null {
    let s = sessions.get(id);
    for (let hops = 0; s && s.state === "cancelled" && s.replacedBy && hops < 20; hops++)
      s = sessions.get(s.replacedBy);
    return s && s.state === "scheduled" ? s.at : null;
  },
  all: () => [...sessions.values()].sort(byTime),
  forClass: (classId: string) =>
    [...sessions.values()].filter((s) => s.classId === classId).sort(byTime),
  add(
    s: Omit<StoredSession, "id" | "state" | "kind" | "substituteId" | "replacedBy" | "replaces"> &
      Partial<StoredSession>,
  ): StoredSession {
    const id = s.id ?? `S-${s.classId.slice(-2)}-${++seq}`;
    const row: StoredSession = {
      state: "scheduled",
      kind: "regular",
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
