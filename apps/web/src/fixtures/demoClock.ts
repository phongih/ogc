/*
 * Demo clock for synthetic schedules. Fixed calendar dates (2026-11-02 …) went stale on the
 * live demo ("Upcoming lessons · 19 days ago", 21/11). Upcoming sessions are instead computed
 * once, at load, as the NEXT occurrence of each class's own weekly slot, in CENTER time
 * (Asia/Ho_Chi_Minh) — "A2 Morning — Mon/Wed" is next on a Monday or Wednesday at 09:00 in
 * Vietnam. Pure given `nowMs`.
 */
import { CENTER_UTC_OFFSET_MIN } from "../lib/centerTime";

const DAY_MS = 86_400_000;

/**
 * Next occurrence strictly after `nowMs` of any of `weekdays` (0 = Sun … 6 = Sat) at hh:mm in a
 * fixed-offset local time (default: the center, UTC+7). Returned as an ISO instant (UTC).
 */
export function nextWeeklySlot(
  weekdays: readonly number[],
  hh: number,
  mm = 0,
  nowMs: number = Date.now(),
  offsetMin: number = CENTER_UTC_OFFSET_MIN,
): string {
  const off = offsetMin * 60_000;
  const localToday = Math.floor((nowMs + off) / DAY_MS) * DAY_MS; // local midnight, as a UTC-shifted epoch
  for (let add = 0; add <= 7; add++) {
    const d = new Date(localToday + add * DAY_MS);
    if (!weekdays.includes(d.getUTCDay())) continue;
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hh, mm) - off;
    if (at > nowMs) return new Date(at).toISOString();
  }
  throw new Error("nextWeeklySlot: no weekday given");
}

// The two synthetic classes' weekly slots, in center time, matching their names.
export const A2_MORNING_NEXT = nextWeeklySlot([1, 3], 9); // Mon/Wed 09:00
export const B1_EVENING_NEXT = nextWeeklySlot([2, 4], 18); // Tue/Thu 18:00
