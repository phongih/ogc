import { describe, expect, it } from "vitest";
import { getClassAttendance } from "./attendance";
import { classes } from "../../fixtures/teaching";

describe("getClassAttendance (authz, fail-closed)", () => {
  it("returns deterministic rows for the teacher who owns the class", () => {
    const rows = getClassAttendance("demo-teacher", classes[0].id);
    expect(rows).not.toBeNull();
    expect(rows!.length).toBeGreaterThan(0);
    for (const r of rows!) {
      expect(r.present + r.absent + r.late).toBeGreaterThan(0);
      expect(r.rate).toBeGreaterThanOrEqual(0);
      expect(r.rate).toBeLessThanOrEqual(100);
    }
  });

  it("fail-closed: returns null for non-owning / non-teacher personas", () => {
    expect(getClassAttendance("demo-learner", classes[0].id)).toBeNull();
    expect(getClassAttendance("demo-staff", classes[0].id)).toBeNull();
    expect(getClassAttendance("demo-guardian", classes[0].id)).toBeNull();
  });
});
