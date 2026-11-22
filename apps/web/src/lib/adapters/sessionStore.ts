import { refill, registerPersistent } from "./persist";
/*
 * P2 · In-memory class schedule (NON-PRODUCTION, synthetic). One source of truth for sessions:
 * attendance, the teacher dashboard and center operations all read it. Seeded from
 * fixtures/attendance; a page reload restores the seed.
 */
import { seedSessions } from "../../fixtures/attendance";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { centerDetails, centers } from "../../fixtures/directory";

export interface StoredSession {
  id: string;
  classId: string;
  title: string;
  at: string;
  state: "scheduled" | "cancelled";
  kind: "regular" | "makeup"; // P2: a make-up session holds booked guests only
  substituteId: string | null;
  // The class teacher when this session started, kept when the class gets a new teacher (owner
  // 22/11: a change of class teacher applies to sessions that have not started yet).
  heldBy?: string | null;
  replacedBy: string | null;
  replaces: string | null;
}

const SEED_OWNERS = { ...classTeachers };
// P2 · center setup wizard adds centers / classes in memory; reset removes them again.
const SEED_CLASS_COUNT = classes.length;
const SEED_CENTER_COUNT = centers.length;
const SEED_ROSTER_KEYS = new Set(Object.keys(rosters));
const SEED_DETAIL_KEYS = new Set(Object.keys(centerDetails));
const resetHooks: (() => void)[] = [];
// P2 · room and length per class (wizard classes have both; seeded classes: no room, 90 min).
export const DEFAULT_SESSION_MIN = 90;
const classMeta = new Map<string, { room: string | null; durationMin: number }>();
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
  classes.length = SEED_CLASS_COUNT;
  centers.length = SEED_CENTER_COUNT;
  for (const k of Object.keys(rosters)) if (!SEED_ROSTER_KEYS.has(k)) delete rosters[k];
  for (const k of Object.keys(centerDetails)) if (!SEED_DETAIL_KEYS.has(k)) delete centerDetails[k];
  classMeta.clear();
  for (const h of resetHooks) h();
}
reset();

const byTime = (a: StoredSession, b: StoredSession) => Date.parse(a.at) - Date.parse(b.at);

export const sessionStore = {
  reset,
  onReset: (h: () => void) => void resetHooks.push(h),
  setClassMeta: (classId: string, meta: { room: string | null; durationMin: number }) =>
    void classMeta.set(classId, meta),
  classMeta: (classId: string) =>
    classMeta.get(classId) ?? { room: null, durationMin: DEFAULT_SESSION_MIN },
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

// Demo data survives reload (persist.ts): the schedule, make-up state and wizard-created
// centers / classes / assignment.
registerPersistent("schedule", {
  dump: () => ({
    sessions,
    bookings,
    selfStudies,
    classMeta,
    seq,
    classTeachers: { ...classTeachers },
    classes: classes.slice(SEED_CLASS_COUNT),
    centers: centers.slice(SEED_CENTER_COUNT),
    rosters: Object.fromEntries(Object.entries(rosters).filter(([k]) => !SEED_ROSTER_KEYS.has(k))),
    centerDetails: Object.fromEntries(
      Object.entries(centerDetails).filter(([k]) => !SEED_DETAIL_KEYS.has(k)),
    ),
  }),
  load: (raw) => {
    const d = raw as Record<string, unknown>;
    refill(sessions, d.sessions);
    refill(bookings, d.bookings);
    refill(selfStudies, d.selfStudies);
    refill(classMeta, d.classMeta);
    seq = Number(d.seq) || 0;
    for (const k of Object.keys(classTeachers)) delete classTeachers[k];
    Object.assign(classTeachers, d.classTeachers ?? SEED_OWNERS);
    classes.length = SEED_CLASS_COUNT;
    classes.push(...((d.classes as typeof classes) ?? []));
    centers.length = SEED_CENTER_COUNT;
    centers.push(...((d.centers as typeof centers) ?? []));
    Object.assign(rosters, d.rosters ?? {});
    Object.assign(centerDetails, d.centerDetails ?? {});
  },
});
