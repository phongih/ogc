import { z } from "zod";
import { Id } from "./common.js";
import { Skill } from "./profile.js";
import { ConfidenceBand } from "./confidence.js";

/*
 * LEARNER INTELLIGENCE — Adaptive Recommendation (LI-1), the CLOSE of the loop.
 *
 * A Recommendation is a pure function of the learner's mastery profile over the set of
 * available (incomplete) activities: it targets the lowest-mastery skill and names one
 * activity that trains it, with an explainable reason that cites the governing skill and
 * its mastery value. NON-PRODUCTION heuristic — deterministic, no model, no LLM.
 *
 * Causal property (the whole point): change the evidence → mastery changes → the
 * recommendation changes, even when the set of available activities is held constant.
 */
export const Recommendation = z.object({
  activityId: z.string().min(1),
  courseId: Id,
  skill: Skill, // the governing (weakest) skill this recommendation targets
  masteryLevel: z.number().min(0).max(100), // that skill's current mastery
  // Explainable: cites the skill and its mastery value, e.g.
  // "Speaking is your lowest skill (mastery 55) — practise 'Describe your weekend'."
  reason: z.string().min(1),
});
export type Recommendation = z.infer<typeof Recommendation>;

// An ordered path step (weakest skill first). The path is derived, not stored.
export const PathStep = z.object({
  activityId: z.string().min(1),
  courseId: Id,
  skill: Skill,
  masteryLevel: z.number().min(0).max(100),
});
export type PathStep = z.infer<typeof PathStep>;

// Self-scoped. Fail-closed: null / empty when the persona is not a learner.
export interface RecommendationPort {
  getRecommendation(personaId: string): Promise<Recommendation | null>;
  getPath(personaId: string): Promise<PathStep[]>;
}

/*
 * LI-2 — Justified recommendation. ADDITIVE: the LI-1 Recommendation above is unchanged.
 * This wraps a Recommendation with an evidence-quality verdict so OGC can explain WHY a
 * recommendation is or is not evidence-justified, distinct from the mastery estimate.
 *
 *  - evidence_based_weakest    — targets the weakest skill, backed by sufficient evidence
 *                                (justified = true).
 *  - exploratory_low_confidence — targets the weakest skill, but the mastery estimate
 *                                rests on thin/placement-only evidence; practising is
 *                                advised to BUILD evidence (justified = false).
 *  - all_caught_up             — no available activity to recommend (justified = false).
 */
export const RecommendationReasonCode = z.enum([
  "evidence_based_weakest",
  "exploratory_low_confidence",
  "all_caught_up",
]);
export type RecommendationReasonCode = z.infer<typeof RecommendationReasonCode>;

export const JustifiedRecommendation = z.object({
  recommendation: Recommendation.nullable(),
  // true only when the recommendation is backed by sufficient evidence (not seed-only).
  justified: z.boolean(),
  reasonCode: RecommendationReasonCode,
  confidence: z.number().min(0).max(100).nullable(), // governing skill's confidence level
  confidenceBand: ConfidenceBand.nullable(),
  reason: z.string().min(1), // human-readable; cites skill, mastery and confidence
});
export type JustifiedRecommendation = z.infer<typeof JustifiedRecommendation>;

// Self-scoped. Never null — always returns a verdict (all_caught_up when nothing is due).
export interface JustifiedRecommendationPort {
  getJustified(personaId: string): Promise<JustifiedRecommendation>;
}
