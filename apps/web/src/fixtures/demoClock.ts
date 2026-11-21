/*
 * Demo clock for synthetic schedules. Fixed calendar dates (2026-11-02 …) went stale on the
 * live demo ("Upcoming lessons · 19 days ago", 21/11). Upcoming sessions are instead computed
 * once, at load, as the NEXT occurrence of each class's own weekly slot — so "A2 Morning —
 * Mon/Wed" really is next on a Monday or Wednesday at 09:00 UTC. Pure given `nowMs`.
 */

const DAY_MS = 86_400_000;

/** Next occurrence strictly after `nowMs` of any of `weekdays` (0 = Sun … 6 = Sat) at hh:mm UTC. */
export function nextWeeklySlot(
  weekdays: readonly number[],
  hh: number,
  mm = 0,
  nowMs: number = Date.now(),
): string {
  const today = new Date(Math.floor(nowMs / DAY_MS) * DAY_MS);
  for (let add = 0; add <= 7; add++) {
    const d = new Date(today.getTime() + add * DAY_MS);
    if (!weekdays.includes(d.getUTCDay())) continue;
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm);
    if (at > nowMs) return new Date(at).toISOString();
  }
  throw new Error("nextWeeklySlot: no weekday given");
}

// The two synthetic classes' weekly slots (UTC), matching their names.
export const A2_MORNING_NEXT = nextWeeklySlot([1, 3], 9); // Mon/Wed 09:00
export const B1_EVENING_NEXT = nextWeeklySlot([2, 4], 18); // Tue/Thu 18:00
