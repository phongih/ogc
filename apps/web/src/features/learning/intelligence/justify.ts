import type {
  JustifiedRecommendation,
  Recommendation,
  Skill,
  SkillConfidence,
} from "@ogc/contracts";
import { skillLabel } from "./skills";

/*
 * LI-2 — Pure eligibility engine. Decides whether a recommendation is evidence-JUSTIFIED,
 * separate from the mastery estimate. A recommendation that targets the weakest skill is
 * "evidence_based" only when that skill's confidence is non-low and backed by ≥1 piece of
 * evidence; otherwise it is "exploratory" — still worth practising (to BUILD evidence) but
 * flagged as not yet evidence-justified. No I/O, no RNG.
 */
export function justify(
  recommendation: Recommendation | null,
  confidence: Record<Skill, SkillConfidence>,
): JustifiedRecommendation {
  if (!recommendation) {
    return {
      recommendation: null,
      justified: false,
      reasonCode: "all_caught_up",
      confidence: null,
      confidenceBand: null,
      reason: "No activities left to recommend right now — you're all caught up.",
    };
  }

  const c = confidence[recommendation.skill];
  const label = skillLabel(recommendation.skill);
  const evidenceBased = c.evidenceCount > 0 && c.band !== "low";

  if (evidenceBased) {
    return {
      recommendation,
      justified: true,
      reasonCode: "evidence_based_weakest",
      confidence: c.level,
      confidenceBand: c.band,
      reason:
        `${label} is your weakest skill (mastery ${recommendation.masteryLevel}) with ` +
        `${c.band}-confidence evidence (${c.level}) — practise to improve it.`,
    };
  }

  return {
    recommendation,
    justified: false,
    reasonCode: "exploratory_low_confidence",
    confidence: c.level,
    confidenceBand: c.band,
    reason:
      `${label} is your weakest skill (mastery ${recommendation.masteryLevel}), but the ` +
      `estimate rests on limited evidence (${c.band} confidence ${c.level}) — practise to ` +
      `build evidence and confirm it.`,
  };
}
