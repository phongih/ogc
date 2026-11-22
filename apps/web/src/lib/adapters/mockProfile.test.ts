import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockPlacement, mockProfile, mockRecommendation } from "./mockProfile";
import { enrollmentStore, learningStore } from "./store";
import { organizations } from "../../fixtures/directory";
import { activities } from "../../fixtures/activities";
import { LEARNER_LINH, LEARNER_MINH, LEARNER_ORG2 } from "../../fixtures/personas";

const ORG2 = organizations[1].id;

describe("mock LI adapters — placement + profile seeding (A1)", () => {
  it("getPlacement returns the learner's own deterministic placement", async () => {
    const p = await mockPlacement.getPlacement(as("demo-learner"));
    expect(p).not.toBeNull();
    expect(p!.learnerId).toBe(LEARNER_LINH);
    expect(p!.skillSeed).toEqual({ reading: 70, use_of_english: 65, speaking: 55 });
  });

  it("getProfile for a learner with no assessed evidence equals the placement seed", async () => {
    const prof = await mockProfile.getProfile(as("demo-learner"));
    expect(prof).not.toBeNull();
    expect(prof!.learnerId).toBe(LEARNER_LINH);
    expect(prof!.cefrBand).toBe("A2");
    expect(prof!.skills.reading).toEqual({ level: 70, evidenceCount: 0, lastUpdatedAt: null });
    expect(prof!.skills.use_of_english).toEqual({
      level: 65,
      evidenceCount: 0,
      lastUpdatedAt: null,
    });
    expect(prof!.skills.speaking).toEqual({ level: 55, evidenceCount: 0, lastUpdatedAt: null });
  });
});

describe("mock LI adapters — recommendation (A4)", () => {
  it("recommends the weakest skill's available activity with an explainable reason", async () => {
    // demo-learner's weakest seeded skill is speaking (55); ACT-A2-4 (speaking) is available.
    const rec = await mockRecommendation.getRecommendation(as("demo-learner"));
    expect(rec).not.toBeNull();
    expect(rec!.skill).toBe("speaking");
    expect(rec!.activityId).toBe("ACT-A2-4");
    expect(rec!.reason).toContain("Speaking");
    expect(rec!.reason).toContain("55");
  });
});

describe("mock LI adapters — persona & tenant isolation, fail-closed (A5)", () => {
  it("returns null / empty for non-learner personas", async () => {
    for (const persona of ["demo-staff", "demo-teacher", "demo-guardian"]) {
      expect(await mockPlacement.getPlacement(as(persona))).toBeNull();
      expect(await mockProfile.getProfile(as(persona))).toBeNull();
      expect(await mockRecommendation.getRecommendation(as(persona))).toBeNull();
      expect(await mockRecommendation.getPath(as(persona))).toEqual([]);
    }
  });

  it("returns null for an unknown persona", async () => {
    expect(await mockProfile.getProfile(as("does-not-exist"))).toBeNull();
  });

  it("a different-tenant learner sees only its OWN org's profile", async () => {
    const prof = await mockProfile.getProfile(as("demo-learner-org2"));
    expect(prof).not.toBeNull();
    expect(prof!.learnerId).toBe(LEARNER_ORG2);
    expect(prof!.orgId).toBe(ORG2);
  });
});

describe("mock LI adapters — assessed evidence updates mastery end-to-end (A2)", () => {
  it("completing an assessed speaking activity raises ONLY speaking mastery", async () => {
    // Use demo-learner-2 (Minh) so the primary demo learner stays pristine for other tests.
    const before = await mockProfile.getProfile(as("demo-learner-2"));
    expect(before).not.toBeNull();
    expect(before!.learnerId).toBe(LEARNER_MINH);
    const speakingSeed = before!.skills.speaking.level; // 60
    expect(before!.skills.speaking.evidenceCount).toBe(0);

    // Enrol in ACT-A2-4's own course (resolved from the fixture), then complete it.
    const speakingActivity = activities.find((a) => a.id === "ACT-A2-4")!;
    enrollmentStore.enroll("demo-learner-2", speakingActivity.courseId);
    const res = learningStore.complete("demo-learner-2", "ACT-A2-4");
    expect(res.completed).toBe(true);

    const att = learningStore.getAttempt(LEARNER_MINH, "ACT-A2-4");
    expect(att?.score).not.toBeNull();
    const score = att!.score!;

    const after = await mockProfile.getProfile(as("demo-learner-2"));
    // Speaking updated by EWMA; evidence count incremented.
    expect(after!.skills.speaking.level).toBe(Math.round(0.4 * score + 0.6 * speakingSeed));
    expect(after!.skills.speaking.evidenceCount).toBe(1);
    // Reading and use_of_english untouched (no assessed evidence for them).
    expect(after!.skills.reading.evidenceCount).toBe(0);
    expect(after!.skills.use_of_english.evidenceCount).toBe(0);
    expect(after!.skills.reading.level).toBe(before!.skills.reading.level);
    expect(after!.skills.use_of_english.level).toBe(before!.skills.use_of_english.level);
  });
});
