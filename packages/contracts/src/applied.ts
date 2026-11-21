import { z } from "zod";
import { Id } from "./common.js";
import { Skill } from "./profile.js";
import { ConfidenceBand } from "./confidence.js";
import { InterventionReasonCode, type InterventionInput } from "./intervention.js";

/*
 * LEARNER INTELLIGENCE — Applied Teacher Recommendation (AUTH-026, resolves G6). ADDITIVE.
 *
 * A teacher may APPLY an eligible alternative so it reaches the learner as "Teacher
 * Recommended", while the system recommendation is always preserved and shown as "System
 * Suggested". No existing LI-1..LI-4 contract/port shape changes. See OGC-ADR-026.
 */

export const AppliedStatus = z.enum([
  "active", // currently reaching the learner
  "reverted", // teacher cancelled
  "superseded", // replaced by a newer applied recommendation
  "fulfilled", // the learner completed the applied activity
  "invalidated", // no longer eligible (became blocked / out-of-scope)
]);
export type AppliedStatus = z.infer<typeof AppliedStatus>;

export const AppliedRecommendation = z.object({
  id: z.string().min(1),
  learnerId: Id,
  orgId: Id,
  activityId: z.string().min(1),
  courseId: Id,
  skill: Skill,
  reasonCode: InterventionReasonCode,
  note: z.string().min(1),
  actorPersonaId: z.string().min(1),
  teacherId: Id,
  systemActivityIdAtApply: z.string().nullable(), // system rec at apply time (preserved)
  appliedAt: z.string(), // deterministic timestamp
  status: AppliedStatus,
});
export type AppliedRecommendation = z.infer<typeof AppliedRecommendation>;

export const ApplyResult = z.object({
  ok: z.boolean(),
  reason: z.string().optional(), // denial reason when ok === false (fail-closed)
  applied: AppliedRecommendation.optional(),
});
export type ApplyResult = z.infer<typeof ApplyResult>;

// The learner's single, source-attributed next action (learner-friendly; no internal ids).
export const NextActionSource = z.enum(["teacher", "system"]);
export type NextActionSource = z.infer<typeof NextActionSource>;

export const LearnerNextAction = z.object({
  source: NextActionSource,
  activityId: z.string().min(1),
  courseId: Id,
  skill: Skill,
  masteryLevel: z.number().min(0).max(100),
  confidenceBand: ConfidenceBand,
  friendlyReason: z.string().min(1), // plain language, no internal activity IDs
  teacherNote: z.string().nullable(), // present only when source === "teacher"
});
export type LearnerNextAction = z.infer<typeof LearnerNextAction>;

// Teacher-facing, fail-closed authorization (owning teacher + same tenant).
export interface AppliedRecommendationPort {
  applyRecommendation(
    viewerPersonaId: string,
    learnerId: string,
    input: InterventionInput,
  ): Promise<ApplyResult>;
  revertApplied(viewerPersonaId: string, learnerId: string): Promise<ApplyResult>;
  getActiveApplied(
    viewerPersonaId: string,
    learnerId: string,
  ): Promise<AppliedRecommendation | null>;
}

// Learner-facing, self-scoped: resolves teacher-applied vs system into one next action.
export interface LearnerNextActionPort {
  getNextAction(personaId: string): Promise<LearnerNextAction | null>;
}
