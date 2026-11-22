// 22/11 (live, build aea6e7f): Teaching showed "9 learners" for B1 Evening — a seed placeholder,
// not the roster. Class sizes now come from each class's roster everywhere they are shown. SYNTHETIC.
import { beforeEach, describe, expect, it } from "vitest";
import { as } from "../../test/grants";
import { mockTeacher } from "./mockTeacher";
import { mockSchedule } from "./mockSchedule";
import { __resetAttendanceForTests } from "./mockAttendance";
import { classes, rosters } from "../../fixtures/teaching";

beforeEach(() => __resetAttendanceForTests());

describe("class size = the roster", () => {
  it("teacher dashboard counts each class's roster", async () => {
    const d = (await mockTeacher.getDashboard(as("demo-teacher")))!;
    expect(d.classes.length).toBeGreaterThan(0);
    for (const c of d.classes) expect(c.learnerCount).toBe(rosters[c.id].length);
  });

  it("center operations counts each class's roster", async () => {
    const o = (await mockSchedule.getOverview(as("demo-staff")))!;
    for (const c of o.classes) expect(c.learnerCount).toBe(rosters[c.classId]?.length ?? 0);
    const total = o.classes.reduce((t, c) => t + c.learnerCount, 0);
    expect(total).toBe(classes.reduce((t, c) => t + (rosters[c.id]?.length ?? 0), 0));
  });
});
