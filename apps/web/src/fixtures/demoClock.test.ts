// Demo clock: upcoming sessions are the NEXT real occurrence of each class's weekly slot.
import { describe, expect, it } from "vitest";
import { A2_MORNING_NEXT, B1_EVENING_NEXT, nextWeeklySlot } from "./demoClock";
import { lessons } from "./learning";
import { classes, upcomingSessions } from "./teaching";

const SAT_21_NOV = Date.parse("2026-11-21T11:00:00.000Z"); // a Saturday

describe("nextWeeklySlot", () => {
  it("Mon/Wed 09:00 from a Saturday → next Monday 09:00", () => {
    expect(nextWeeklySlot([1, 3], 9, 0, SAT_21_NOV)).toBe("2026-11-23T09:00:00.000Z");
  });
  it("same day, before the slot → today; after the slot → the next slot day", () => {
    const mon0800 = Date.parse("2026-11-23T08:00:00.000Z");
    const mon1000 = Date.parse("2026-11-23T10:00:00.000Z");
    expect(nextWeeklySlot([1, 3], 9, 0, mon0800)).toBe("2026-11-23T09:00:00.000Z");
    expect(nextWeeklySlot([1, 3], 9, 0, mon1000)).toBe("2026-11-25T09:00:00.000Z");
  });
  it("Tue/Thu 18:00 from Thursday 19:00 → next Tuesday", () => {
    expect(nextWeeklySlot([2, 4], 18, 0, Date.parse("2026-11-26T19:00:00.000Z"))).toBe(
      "2026-12-01T18:00:00.000Z",
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
  it("A2 Morning is on Mon/Wed 09:00, B1 Evening on Tue/Thu 18:00 (UTC)", () => {
    expect([1, 3]).toContain(new Date(A2_MORNING_NEXT).getUTCDay());
    expect(new Date(A2_MORNING_NEXT).getUTCHours()).toBe(9);
    expect([2, 4]).toContain(new Date(B1_EVENING_NEXT).getUTCDay());
    expect(new Date(B1_EVENING_NEXT).getUTCHours()).toBe(18);
  });
});
