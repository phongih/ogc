import { z } from "zod";
import { Id } from "./common.js";

// ── Activities ───────────────────────────────────────────────────────────────
export const ActivityKind = z.enum(["reading", "exercise", "quiz", "speaking"]);
export type ActivityKind = z.infer<typeof ActivityKind>;

export const LearningActivity = z.object({
  id: z.string().min(1),
  orgId: Id, // tenant root the activity belongs to
  courseId: Id,
  lessonId: z.string().min(1).nullable(),
  title: z.string().min(1),
  kind: ActivityKind,
  // Relative weight toward course progress. Progress is deterministic from these.
  weight: z.number().int().positive(),
  // Whether a completed attempt also yields a deterministic assessment score.
  assessed: z.boolean(),
});
export type LearningActivity = z.infer<typeof LearningActivity>;

// ── Attempts (completion) ─────────────────────────────────────────────────────
export const AttemptState = z.enum(["not_started", "in_progress", "completed"]);
export type AttemptState = z.infer<typeof AttemptState>;

export const LearningAttempt = z.object({
  id: z.string().min(1),
  // Owner is the LEARNER (domain subject), not the acting persona. A persona acts on
  // its own learnerId; roster learners without a persona still own attempts.
  learnerId: Id,
  activityId: z.string().min(1),
  state: AttemptState,
  completedAt: z.string().nullable(), // deterministic ISO in the mock, or null
  // Assessment score is DISTINCT from completion: null unless the activity is `assessed`
  // AND has been completed. Completing a non-assessed activity never produces a score.
  score: z.number().min(0).max(100).nullable(),
});
export type LearningAttempt = z.infer<typeof LearningAttempt>;

// ── Evidence (submissions + AI feedback) ──────────────────────────────────────
// AI-generated feedback is evidence, NOT an assessment score. Kept separate on purpose.
// `practice_result` (OGC-AUTH-030) records a deterministic practice submission summary.
export const EvidenceKind = z.enum(["submission", "ai_feedback", "practice_result"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const LearningEvidence = z.object({
  id: z.string().min(1),
  learnerId: Id,
  activityId: z.string().min(1),
  kind: EvidenceKind,
  text: z.string(),
  at: z.string(), // deterministic ISO in the mock
});
export type LearningEvidence = z.infer<typeof LearningEvidence>;

// ── Progress states + snapshot ───────────────────────────────────────────────
// Explicit course-level progress state (S5-C). Derived deterministically:
//   completed == 0            → not_started
//   0 < completed < total     → in_progress
//   completed == total (>0)   → completed
export const ProgressState = z.enum(["not_started", "in_progress", "completed"]);
export type ProgressState = z.infer<typeof ProgressState>;

export const ProgressSnapshot = z.object({
  learnerId: Id, // the domain subject (no personaId here — identity is separated)
  orgId: Id, // tenant root the progress belongs to
  courseId: Id,
  courseTitle: z.string().min(1),
  state: ProgressState,
  totalActivities: z.number().int().nonnegative(),
  completedActivities: z.number().int().nonnegative(),
  assessedCount: z.number().int().nonnegative(),
  // Deterministic: weighted completion / total weight, rounded to an integer percent.
  progressPct: z.number().min(0).max(100),
  lastActivityAt: z.string().nullable(),
});
export type ProgressSnapshot = z.infer<typeof ProgressSnapshot>;

// Learner-level aggregation across a learner's courses (S5-C).
export const LearnerProgressSummary = z.object({
  learnerId: Id,
  orgId: Id,
  courseCount: z.number().int().nonnegative(),
  overallPct: z.number().min(0).max(100), // mean of per-course progressPct, rounded
  state: ProgressState,
  snapshots: z.array(ProgressSnapshot),
});
export type LearnerProgressSummary = z.infer<typeof LearnerProgressSummary>;

// Self-scoped learning: a persona acts only on its own enrolled courses/activities.
export interface LearningPort {
  listActivities(personaId: string, courseId: string): Promise<LearningActivity[]>;
  getAttempt(personaId: string, activityId: string): Promise<LearningAttempt | null>;
  // Fail-closed + idempotent: denies when the persona is not enrolled in the activity's
  // course, and never double-counts a second completion of the same activity.
  completeActivity(
    personaId: string,
    activityId: string,
  ): Promise<{ completed: boolean; reason?: string }>;
  getEvidence(personaId: string, activityId: string): Promise<LearningEvidence[]>;
  getProgress(personaId: string, courseId: string): Promise<ProgressSnapshot | null>;
  listMyProgress(personaId: string): Promise<ProgressSnapshot[]>;
}

// Cross-role viewing: a viewer persona reads ANOTHER learner's progress only when
// authorized (teacher of an assigned class, guardian of a linked learner, or same-org
// staff). Returns null when the viewer is not authorized for that learner (fail-closed).
export interface ProgressViewPort {
  getLearnerProgress(
    viewerPersonaId: string,
    learnerId: string,
  ): Promise<LearnerProgressSummary | null>;
}
