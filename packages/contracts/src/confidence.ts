import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";
import { Skill, skillMap } from "./profile.js";

/*
 * LEARNER INTELLIGENCE — Evidence Quality & Mastery Confidence (LI-2).
 *
 * Confidence is SEPARATE from mastery level (profile.ts). Mastery estimates "how good";
 * confidence estimates "how strongly the evidence supports that estimate". A high mastery
 * resting only on a placement seed is low-confidence. Fully additive: no existing LI-1
 * type is modified. NON-PRODUCTION deterministic — no psychometrics, no certification.
 */

// How an assessed activity produces its score. Objective (quiz/exercise) is more reliable
// than subjective (speaking) in this synthetic model. Derived from ActivityKind.
export const AssessmentType = z.enum(["objective", "subjective"]);
export type AssessmentType = z.infer<typeof AssessmentType>;

export const ConfidenceBand = z.enum(["low", "medium", "high"]);
export type ConfidenceBand = z.infer<typeof ConfidenceBand>;

// The four evidence-quality dimensions, each 0..100. Deterministic, explainable.
//  validity        — share of considered evidence that passed validation
//  coverage        — share of the skill's assessable surface actually evidenced
//  recency         — how recent the skill's newest evidence is (vs the learner's newest)
//  typeReliability — average reliability of the evidence's assessment types
export const EvidenceQuality = z.object({
  validity: z.number().min(0).max(100),
  coverage: z.number().min(0).max(100),
  recency: z.number().min(0).max(100),
  typeReliability: z.number().min(0).max(100),
});
export type EvidenceQuality = z.infer<typeof EvidenceQuality>;

export const SkillConfidence = z.object({
  level: z.number().min(0).max(100), // weighted blend of the four dimensions
  band: ConfidenceBand,
  evidenceCount: z.number().int().nonnegative(),
  quality: EvidenceQuality,
});
export type SkillConfidence = z.infer<typeof SkillConfidence>;

export const MasteryConfidence = z.object({
  learnerId: Id,
  orgId: Id,
  skills: skillMap(SkillConfidence), // total map over the current taxonomy
});
export type MasteryConfidence = z.infer<typeof MasteryConfidence>;

/*
 * Normalized evidence for the confidence engine — DISTINCT from SkillEvidence (profile.ts),
 * which feeds the mastery engine. Carries the assessment type and a validity flag so the
 * quality dimensions can be computed. Additive: SkillEvidence is unchanged.
 */
export const QualityEvidence = z.object({
  attemptId: z.string().min(1),
  skill: Skill,
  assessmentType: AssessmentType,
  valid: z.boolean(),
  at: z.string(),
});
export type QualityEvidence = z.infer<typeof QualityEvidence>;

// Self-scoped read of a learner's own mastery confidence. Fail-closed → null.
export interface MasteryConfidencePort {
  getConfidence(viewer: IiosGrantedContext): Promise<MasteryConfidence | null>;
}
