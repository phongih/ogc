import { describe, expect, it } from "vitest";
import { mockJustifiedRecommendation, mockMasteryConfidence, mockProfile } from "./mockProfile";
import { learningStore } from "./store";
import { organizations } from "../../fixtures/directory";
import { LEARNER_ORG2 } from "../../fixtures/personas";

const ORG2 = organizations[1].id;

describe("LI-2 adapter — confidence is separate from mastery (B1)", () => {
  it("a seed-only learner has positive mastery but zero-evidence (low) confidence", async () => {
    const profile = await mockProfile.getProfile("demo-learner");
    const conf = await mockMasteryConfidence.getConfidence("demo-learner");
    expect(profile!.skills.speaking.level).toBe(55); // mastery from placement
    expect(conf).not.toBeNull();
    // No assessed evidence yet → every skill's confidence is zero-evidence, low band.
    for (const s of ["reading", "use_of_english", "speaking"] as const) {
      expect(conf!.skills[s].evidenceCount).toBe(0);
      expect(conf!.skills[s].band).toBe("low");
    }
  });
});

describe("LI-2 adapter — justification reflects evidence strength (B7 end-to-end)", () => {
  it("a seed-only weakest skill yields an EXPLORATORY, not-justified recommendation", async () => {
    const j = await mockJustifiedRecommendation.getJustified("demo-learner");
    expect(j.recommendation).not.toBeNull();
    expect(j.recommendation!.skill).toBe("speaking"); // weakest seed
    expect(j.justified).toBe(false);
    expect(j.reasonCode).toBe("exploratory_low_confidence");
    expect(j.confidenceBand).toBe("low");
    expect(j.reason).toContain("Speaking");
  });

  it("completing an assessed activity raises that skill's confidence (low→high) and the verdict stays consistent", async () => {
    // demo-learner (Linh) is pre-enrolled in the A2 course; complete the speaking activity.
    const res = learningStore.complete("demo-learner", "ACT-A2-4");
    expect(res.completed).toBe(true);

    const conf = await mockMasteryConfidence.getConfidence("demo-learner");
    // Speaking now has one subjective, fully-covered, most-recent piece of evidence.
    expect(conf!.skills.speaking.evidenceCount).toBe(1);
    expect(conf!.skills.speaking.band).toBe("high");
    expect(conf!.skills.speaking.quality.coverage).toBe(100);

    // Invariant: the recommendation is "justified" exactly when its skill has non-low,
    // evidenced confidence — regardless of which skill ends up weakest after the update.
    const j = await mockJustifiedRecommendation.getJustified("demo-learner");
    const recSkill = j.recommendation!.skill;
    const c = conf!.skills[recSkill];
    const evidenceBased = c.evidenceCount > 0 && c.band !== "low";
    expect(j.justified).toBe(evidenceBased);
    expect(j.reasonCode).toBe(
      evidenceBased ? "evidence_based_weakest" : "exploratory_low_confidence",
    );
  });
});

describe("LI-2 adapter — persona & tenant isolation, fail-closed (A5 preserved)", () => {
  it("non-learner personas get no confidence and an all-caught-up verdict", async () => {
    for (const persona of ["demo-staff", "demo-teacher", "demo-guardian"]) {
      expect(await mockMasteryConfidence.getConfidence(persona)).toBeNull();
      const j = await mockJustifiedRecommendation.getJustified(persona);
      expect(j.recommendation).toBeNull();
      expect(j.justified).toBe(false);
      expect(j.reasonCode).toBe("all_caught_up");
    }
  });

  it("a different-tenant learner sees only its OWN org's confidence", async () => {
    const conf = await mockMasteryConfidence.getConfidence("demo-learner-org2");
    expect(conf).not.toBeNull();
    expect(conf!.learnerId).toBe(LEARNER_ORG2);
    expect(conf!.orgId).toBe(ORG2);
  });
});
