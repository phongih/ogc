import { describe, expect, it } from "vitest";
import { relativeDay } from "./time";

const NOW = Date.parse("2026-11-03T00:00:00.000Z");

describe("relativeDay", () => {
  it("returns Unscheduled for null/invalid input", () => {
    expect(relativeDay(null, NOW)).toBe("Unscheduled");
    expect(relativeDay("not-a-date", NOW)).toBe("Unscheduled");
  });

  it("labels same/adjacent UTC days", () => {
    expect(relativeDay("2026-11-03T13:30:00.000Z", NOW)).toBe("Today");
    expect(relativeDay("2026-11-04T09:00:00.000Z", NOW)).toBe("Tomorrow");
    expect(relativeDay("2026-11-02T09:00:00.000Z", NOW)).toBe("Yesterday");
  });

  it("labels further days in both directions", () => {
    expect(relativeDay("2026-11-06T00:00:00.000Z", NOW)).toBe("In 3 days");
    expect(relativeDay("2026-10-31T00:00:00.000Z", NOW)).toBe("3 days ago");
  });
});
