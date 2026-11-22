import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockLearningPath, mockPrerequisite } from "./mockProfile";
import { learningStore } from "./store";
import { organizations } from "../../fixtures/directory";
import { LEARNER_ORG2 } from "../../fixtures/personas";

const ORG2 = organizations[1].id;
const stateOf = (view: { steps: { activityId: string; state: string }[] }, id: string) =>
  view.steps.find((s) => s.activityId === id)?.state;

describe("LI-3 adapter — demo learner path (P1, P5)", () => {
  it("shows prerequisite states and recommends the weakest AVAILABLE skill, not the blocked weakest", async () => {
    const view = await mockLearningPath.getLearningPath(as("demo-learner"));
    expect(view).not.toBeNull();
    expect(view!.graph.valid).toBe(true);
    // Seeded completions: ACT-A2-1, ACT-A2-2, ACT-B1-1.
    expect(stateOf(view!, "ACT-A2-1")).toBe("completed");
    expect(stateOf(view!, "ACT-A2-3")).toBe("available"); // needs ACT-A2-2 (done)
    expect(stateOf(view!, "ACT-A2-4")).toBe("blocked"); // speaking, needs ACT-A2-3
    expect(view!.steps.find((s) => s.activityId === "ACT-A2-4")!.blockedBy).toEqual(["ACT-A2-3"]);

    // Speaking (mastery 55) is the weakest skill but is BLOCKED → next step targets the
    // weakest AVAILABLE skill (Use of English), never bypassing the prerequisite.
    expect(view!.nextStep.recommendation).not.toBeNull();
    expect(view!.nextStep.recommendation!.skill).toBe("use_of_english");
  });
});

describe("LI-3 adapter — isolation, fail-closed (P4, A5 preserved)", () => {
  it("non-learner personas get no path and no prerequisites", async () => {
    for (const persona of ["demo-staff", "demo-teacher", "demo-guardian"]) {
      expect(await mockLearningPath.getLearningPath(as(persona))).toBeNull();
      expect(await mockPrerequisite.getPrerequisites(as(persona))).toEqual([]);
    }
  });

  it("a different-tenant learner sees only its own org's path", async () => {
    const view = await mockLearningPath.getLearningPath(as("demo-learner-org2"));
    expect(view).not.toBeNull();
    expect(view!.learnerId).toBe(LEARNER_ORG2);
    expect(view!.orgId).toBe(ORG2);
  });
});

describe("LI-3 adapter — completing a prerequisite unlocks the dependent (P2)", () => {
  it("completing ACT-A2-3 unlocks the blocked speaking activity, which then becomes the next step", async () => {
    // Runs last so the seeded demo-learner path above stays pristine.
    const before = await mockLearningPath.getLearningPath(as("demo-learner"));
    expect(stateOf(before!, "ACT-A2-4")).toBe("blocked");

    const res = learningStore.complete("demo-learner", "ACT-A2-3");
    expect(res.completed).toBe(true);

    const after = await mockLearningPath.getLearningPath(as("demo-learner"));
    expect(stateOf(after!, "ACT-A2-3")).toBe("completed");
    expect(stateOf(after!, "ACT-A2-4")).toBe("available"); // unlocked
    // Speaking (weakest, mastery 55) is now available → it becomes the recommended next step.
    expect(after!.nextStep.recommendation!.activityId).toBe("ACT-A2-4");
    expect(after!.nextStep.recommendation!.skill).toBe("speaking");
  });
});
