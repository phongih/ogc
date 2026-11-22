import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";
import { Skill } from "./profile.js";
import { ConfidenceBand } from "./confidence.js";
import { JustifiedRecommendation } from "./recommendation.js";
import { GraphValidation } from "./prerequisites.js";

/*
 * LEARNER INTELLIGENCE — Learning Path (LI-3). ADDITIVE.
 *
 * A deterministic, prerequisite-governed, topologically-ordered path over a learner's
 * in-scope activities. Each step carries its state and (if blocked) what blocks it; the
 * path's nextStep reuses the LI-2 JustifiedRecommendation but is chosen only from AVAILABLE
 * (prerequisite-unblocked) activities — prerequisites are never bypassed by mastery/confidence.
 */
export const PathState = z.enum(["completed", "available", "blocked"]);
export type PathState = z.infer<typeof PathState>;

export const LearningPathStep = z.object({
  activityId: z.string().min(1),
  courseId: Id,
  title: z.string(),
  skill: Skill,
  state: PathState,
  masteryLevel: z.number().min(0).max(100),
  confidenceBand: ConfidenceBand,
  // Uncompleted prerequisite activity ids (empty unless state === "blocked").
  blockedBy: z.array(z.string()),
});
export type LearningPathStep = z.infer<typeof LearningPathStep>;

export const LearningPathView = z.object({
  learnerId: Id,
  orgId: Id,
  steps: z.array(LearningPathStep), // topologically ordered, deterministic
  nextStep: JustifiedRecommendation, // prerequisite-aware (chosen from AVAILABLE only)
  graph: GraphValidation, // fail-closed integrity status
});
export type LearningPathView = z.infer<typeof LearningPathView>;

// Self-scoped. Fail-closed → null when the persona is not a learner.
export interface LearningPathPort {
  getLearningPath(viewer: IiosGrantedContext): Promise<LearningPathView | null>;
}
