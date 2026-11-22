import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import type { LessonPlanDraft } from "@ogc/contracts";
import { mockLessonPlan } from "./mockLessonPlan";
import { classes } from "../../fixtures/teaching";

const TEACHER = "demo-teacher"; // owns classes[0] and classes[1]
const LEARNER = "demo-learner"; // no teacher scope

const baseDraft = (classId: string, overrides: Partial<LessonPlanDraft> = {}): LessonPlanDraft => ({
  id: "",
  classId,
  title: "Unit 7 — Making plans",
  objectives: ["Use 'be going to' for plans"],
  activities: [{ title: "Pair practice", durationMin: 20 }],
  resources: ["Worksheet 7"],
  assessment: "Exit ticket: one sentence about the weekend",
  status: "draft",
  ...overrides,
});

describe("mock lesson plan", () => {
  it("saves a draft for the teacher's own class and lists it", async () => {
    const classId = classes[0].id;
    const result = await mockLessonPlan.save(as(TEACHER), baseDraft(classId));
    expect(result.saved).toBe(true);
    expect(result.errors).toEqual([]);

    const list = await mockLessonPlan.listForClass(as(TEACHER), classId);
    expect(list.length).toBeGreaterThanOrEqual(1);
    // org scope is derived from the class, not the client
    expect(list[0].orgId).toBe(classes[0].orgId);
  });

  it("enforces completeness when marking a plan 'ready'", async () => {
    const classId = classes[0].id;
    const result = await mockLessonPlan.save(
      as(TEACHER),
      baseDraft(classId, {
        status: "ready",
        title: "",
        objectives: [],
        activities: [],
        assessment: "",
      }),
    );
    expect(result.saved).toBe(false);
    expect(result.errors.length).toBe(4); // title, objective, activity, assessment
  });

  // NEGATIVE: a persona without teacher scope cannot edit lesson plans.
  it("denies lesson-plan editing to a non-teacher persona", async () => {
    const result = await mockLessonPlan.save(as(LEARNER), baseDraft(classes[0].id));
    expect(result.saved).toBe(false);
    expect(result.errors[0]).toMatch(/not authorized/i);
  });

  // NEGATIVE: a teacher cannot edit plans for a class they do not own.
  it("denies editing a class not assigned to the teacher", async () => {
    const result = await mockLessonPlan.save(
      as(TEACHER),
      baseDraft("00000000-0000-4000-8000-0000000000zz"),
    );
    expect(result.saved).toBe(false);
    expect(result.errors[0]).toMatch(/not authorized/i);
  });
});
