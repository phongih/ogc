import { describe, expect, it } from "vitest";
import { mockLearner } from "./mockLearner";
import { mockTeacher } from "./mockTeacher";

describe("learner/teacher adapters (persona scoping, fail-closed)", () => {
  it("returns a learner dashboard only for a learner persona", async () => {
    const d = await mockLearner.getDashboard("demo-learner");
    expect(d?.enrolled.length).toBeGreaterThan(0);
    expect(await mockLearner.getDashboard("demo-staff")).toBeNull(); // fail-closed
    expect(await mockLearner.getDashboard("unknown")).toBeNull();
  });

  it("returns a teacher dashboard only for a teacher persona", async () => {
    const d = await mockTeacher.getDashboard("demo-teacher");
    expect(d?.classes.length).toBeGreaterThan(0);
    expect(await mockTeacher.getDashboard("demo-learner")).toBeNull(); // fail-closed
  });

  it("returns a roster for a class and empty for unknown", async () => {
    const d = await mockTeacher.getDashboard("demo-teacher");
    const roster = await mockTeacher.getClassRoster(d!.classes[0].id);
    expect(roster.length).toBeGreaterThan(0);
    expect(await mockTeacher.getClassRoster("missing")).toEqual([]);
  });
});
