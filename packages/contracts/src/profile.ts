import { z } from "zod";
import { Id } from "./common.js";
import { CourseLevel } from "./catalog.js";

/*
 * LEARNER INTELLIGENCE — Learner Profile (LI-1).
 *
 * The profile is the durable substrate the adaptation loop reads and writes:
 *   Placement seeds it → assessment Evidence updates it → Recommendation reads it.
 *
 * It is DISTINCT from ProgressSnapshot (learning.ts): progress measures COMPLETION
 * (how much of a course is done); mastery measures PROFICIENCY per skill, derived
 * only from assessed evidence. NON-PRODUCTION synthetic — no real psychometrics.
 */

// Skill taxonomy for LI-1. Mapped deterministically from ActivityKind:
//   reading → reading · exercise|quiz → use_of_english · speaking → speaking
export const Skill = z.enum(["reading", "use_of_english", "speaking"]);
export type Skill = z.infer<typeof Skill>;

// Per-skill mastery. `level` is a 0..100 proficiency estimate; `evidenceCount` is the
// number of assessed pieces of evidence folded in; `lastUpdatedAt` is the latest
// evidence timestamp applied (null when only the placement seed is present).
export const SkillMastery = z.object({
  level: z.number().min(0).max(100),
  evidenceCount: z.number().int().nonnegative(),
  lastUpdatedAt: z.string().nullable(),
});
export type SkillMastery = z.infer<typeof SkillMastery>;

// A value keyed by EVERY skill in the taxonomy — an explicit object (not z.record),
// so the inferred type is a total map (no `| undefined` on lookup). Keep the keys in
// sync with the Skill enum above and ALL_SKILLS in the engine.
export const skillMap = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ reading: value, use_of_english: value, speaking: value });

export const LearnerProfile = z.object({
  learnerId: Id, // the domain subject (not a personaId — identity stays separated)
  orgId: Id, // tenant root the profile belongs to
  cefrBand: CourseLevel, // seeded by placement
  // One mastery entry per skill in the taxonomy. Always fully populated.
  skills: skillMap(SkillMastery),
});
export type LearnerProfile = z.infer<typeof LearnerProfile>;

/*
 * A single assessed piece of evidence, normalized from a completed LearningAttempt.
 * Only produced for activities that are `assessed` AND completed with a non-null score.
 * `attemptId` is the idempotency key: the same attempt never updates mastery twice.
 */
export const SkillEvidence = z.object({
  attemptId: z.string().min(1),
  skill: Skill,
  score: z.number().min(0).max(100),
  at: z.string(), // deterministic ISO — defines evidence ordering (tie-break: attemptId)
});
export type SkillEvidence = z.infer<typeof SkillEvidence>;

// Self-scoped read of a learner's own profile. Fail-closed: null when the persona is
// not a learner, or (for a viewer variant) not authorized for the subject.
export interface LearningProfilePort {
  getProfile(personaId: string): Promise<LearnerProfile | null>;
}
