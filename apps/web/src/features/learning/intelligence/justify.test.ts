import { describe, expect, it } from "vitest";
import type { ConfidenceBand, Recommendation, Skill, SkillConfidence } from "@ogc/contracts";
import { justify } from "./justify";

const rec: Recommendation = {
  activityId: "ACT-A2-4",
  courseId: "C1",
  skill: "speaking",
  masteryLevel: 55,
  reason: "seed",
};

const conf = (band: ConfidenceBand, evidenceCount: number, level = 50): Record<Skill, SkillConfidence> => ({
  reading: { level: 0, band: "low", evidenceCount: 0, quality: { validity: 0, coverage: 0, recency: 0, typeReliability: 0 } },
  use_of_english: { level: 0, band: "low", evidenceCount: 0, quality: { validity: 0, coverage: 0, recency: 0, typeReliability: 0 } },
  speaking: { level, band, evidenceCount, quality: { validity: 100, coverage: 100, recency: 100, typeReliability: 60 } },
});

describe("justify engine — eligibility & reason codes (B7)", () => {
  it("evidence-based when the weakest skill has non-low, evidenced confidence", () => {
    const j = justify(rec, conf("high", 2, 88));
    expect(j.justified).toBe(true);
    expect(j.reasonCode).toBe("evidence_based_weakest");
    expect(j.confidence).toBe(88);
    expect(j.confidenceBand).toBe("high");
    expect(j.reason).toContain("Speaking");
    expect(j.reason).toContain("55"); // mastery
  });

  it("medium confidence with evidence is still evidence-based", () => {
    const j = justify(rec, conf("medium", 1, 50));
    expect(j.justified).toBe(true);
    expect(j.reasonCode).toBe("evidence_based_weakest");
  });

  it("exploratory when the estimate rests on low-confidence / seed-only evidence", () => {
    const j = justify(rec, conf("low", 0, 0));
    expect(j.justified).toBe(false);
    expect(j.reasonCode).toBe("exploratory_low_confidence");
    expect(j.confidenceBand).toBe("low");
    expect(j.reason).toContain("Speaking");
    expect(j.reason).toContain("limited evidence");
  });

  it("evidence present but still low band → exploratory (not justified)", () => {
    const j = justify(rec, conf("low", 1, 20));
    expect(j.justified).toBe(false);
    expect(j.reasonCode).toBe("exploratory_low_confidence");
  });

  it("all caught up when there is no recommendation", () => {
    const j = justify(null, conf("high", 3));
    expect(j.recommendation).toBeNull();
    expect(j.justified).toBe(false);
    expect(j.reasonCode).toBe("all_caught_up");
    expect(j.confidence).toBeNull();
    expect(j.confidenceBand).toBeNull();
  });
});
