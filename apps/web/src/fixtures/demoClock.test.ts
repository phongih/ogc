// Demo clock: upcoming sessions are the NEXT real occurrence of each class's weekly slot,
// in CENTER time (Asia/Ho_Chi_Minh, UTC+7) — not UTC, not the viewer's timezone.
import { describe, expect, it } from "vitest";
import { A2_MORNING_NEXT, B1_EVENING_NEXT, nextWeeklySlot, recentWeeklySlots } from "./demoClock";
import { lessons } from "./learning";
import { classes, upcomingSessions } from "./teaching";
import { formatCenterDateTime } from "../lib/centerTime";

// Sat 21/11/2026 18:00 in Vietnam
const SAT_21_NOV_1800_ICT = Date.parse("2026-11-21T11:00:00.000Z");

describe("nextWeeklySlot (center time)", () => {
  it("Mon/Wed 09:00 from a Saturday → next Monday 09:00 in Vietnam (= 02:00Z)", () => {
    expect(nextWeeklySlot([1, 3], 9, 0, SAT_21_NOV_1800_ICT)).toBe("2026-11-23T02:00:00.000Z");
  });
  it("same center day, before the slot → today; after the slot → next slot day", () => {
    const mon0800ict = Date.parse("2026-11-23T01:00:00.000Z");
    const mon1000ict = Date.parse("2026-11-23T03:00:00.000Z");
    expect(nextWeeklySlot([1, 3], 9, 0, mon0800ict)).toBe("2026-11-23T02:00:00.000Z");
    expect(nextWeeklySlot([1, 3], 9, 0, mon1000ict)).toBe("2026-11-25T02:00:00.000Z");
  });
  it("Tue/Thu 18:00 from Thursday 19:00 Vietnam → next Tuesday 18:00 (= 11:00Z)", () => {
    expect(nextWeeklySlot([2, 4], 18, 0, Date.parse("2026-11-26T12:00:00.000Z"))).toBe(
      "2026-12-01T11:00:00.000Z",
    );
  });
  it("uses the CENTER weekday even when UTC is still on the previous day", () => {
    // Mon 23/11 05:00 ICT is Sun 22/11 22:00Z — the Monday 09:00 slot is still ahead today.
    expect(nextWeeklySlot([1, 3], 9, 0, Date.parse("2026-11-22T22:00:00.000Z"))).toBe(
      "2026-11-23T02:00:00.000Z",
    );
  });
});

describe("synthetic schedule is always upcoming and matches the class names", () => {
  it("every scheduled lesson / session / next class session is in the future", () => {
    const now = Date.now();
    const dates = [
      ...lessons.map((l) => l.scheduledAt).filter((x): x is string => !!x),
      ...upcomingSessions.map((s) => s.at),
      ...classes.map((c) => c.nextSessionAt).filter((x): x is string => !!x),
    ];
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(Date.parse(d)).toBeGreaterThan(now);
  });
  it("A2 Morning reads Mon/Wed 09:00 and B1 Evening Tue/Thu 18:00 in center time", () => {
    expect(formatCenterDateTime(A2_MORNING_NEXT)).toMatch(
      /^(Mon|Wed), \d{2}\/\d{2}\/\d{4}, 09:00$/,
    );
    expect(formatCenterDateTime(B1_EVENING_NEXT)).toMatch(
      /^(Tue|Thu), \d{2}\/\d{2}\/\d{4}, 18:00$/,
    );
  });
});

describe("recentWeeklySlots (center time, started only)", () => {
  it("last 4 Mon/Wed 09:00 sessions before Sat 21/11 18:00 Vietnam, oldest first", () => {
    expect(recentWeeklySlots([1, 3], 9, 4, SAT_21_NOV_1800_ICT)).toEqual([
      "2026-11-09T02:00:00.000Z",
      "2026-11-11T02:00:00.000Z",
      "2026-11-16T02:00:00.000Z",
      "2026-11-18T02:00:00.000Z",
    ]);
  });
  it("a session that started today counts; one later today does not", () => {
    const mon1000ict = Date.parse("2026-11-23T03:00:00.000Z");
    expect(recentWeeklySlots([1, 3], 9, 1, mon1000ict)).toEqual(["2026-11-23T02:00:00.000Z"]);
    const mon0800ict = Date.parse("2026-11-23T01:00:00.000Z");
    expect(recentWeeklySlots([1, 3], 9, 1, mon0800ict)).toEqual(["2026-11-18T02:00:00.000Z"]);
  });
});
