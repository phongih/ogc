import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";
import { Skill } from "./profile.js";

/*
 * OGC-METH-001 — Synthetic learning PRACTICE contracts (OGC-AUTH-030). ADDITIVE, SYNTHETIC.
 *
 * A practice activity is an interactive, deterministically-scored exercise whose score is
 * derived from the LEARNER'S responses (not a hash of ids). Submitting it produces a scored
 * attempt that feeds the EXISTING LI-1 mastery pipeline unchanged. No proprietary teaching
 * material, no real learner data, no LLM/ASR. Scoring is pure and versioned; ingestion is
 * idempotent (keyed by attemptId). The learner-facing VIEW never carries the correct answers.
 */

// A single answer option.
export const PracticeOption = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});
export type PracticeOption = z.infer<typeof PracticeOption>;

// A full practice item INCLUDING the correct answer — authored/fixture side only, never
// sent to the learner before submission.
export const PracticeItem = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(PracticeOption).min(2),
  correctOptionId: z.string().min(1),
});
export type PracticeItem = z.infer<typeof PracticeItem>;

// A full practice activity (authoring/fixture side). `activityId` references an existing
// LearningActivity so scoring flows into the established path/progress model.
export const PracticeActivity = z.object({
  activityId: z.string().min(1),
  skill: Skill,
  title: z.string().min(1),
  prompt: z.string().min(1),
  scoringVersion: z.string().min(1), // stamped onto every result for reproducibility
  items: z.array(PracticeItem).min(1),
});
export type PracticeActivity = z.infer<typeof PracticeActivity>;

// ── Learner-facing view (NO correct answers) ─────────────────────────────────
export const PracticeItemView = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  options: z.array(PracticeOption).min(2),
});
export type PracticeItemView = z.infer<typeof PracticeItemView>;

export const PracticeActivityView = z.object({
  activityId: z.string().min(1),
  skill: Skill,
  title: z.string().min(1),
  prompt: z.string().min(1),
  scoringVersion: z.string().min(1),
  items: z.array(PracticeItemView).min(1),
});
export type PracticeActivityView = z.infer<typeof PracticeActivityView>;

// ── Submission + result ──────────────────────────────────────────────────────
export const PracticeResponse = z.object({
  itemId: z.string().min(1),
  optionId: z.string().min(1),
});
export type PracticeResponse = z.infer<typeof PracticeResponse>;

// attemptId is the IDEMPOTENCY key: a replay with the same attemptId never double-counts.
export const PracticeSubmission = z.object({
  attemptId: z.string().min(1),
  responses: z.array(PracticeResponse),
});
export type PracticeSubmission = z.infer<typeof PracticeSubmission>;

export const PracticeItemResult = z.object({
  itemId: z.string().min(1),
  chosenOptionId: z.string().nullable(), // null when the learner left it unanswered
  correctOptionId: z.string().min(1),
  correct: z.boolean(),
});
export type PracticeItemResult = z.infer<typeof PracticeItemResult>;

export const PracticeResult = z.object({
  activityId: z.string().min(1),
  learnerId: Id,
  skill: Skill,
  score: z.number().min(0).max(100), // deterministic: round(correct / total * 100)
  correct: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  scoringVersion: z.string().min(1),
  items: z.array(PracticeItemResult),
});
export type PracticeResult = z.infer<typeof PracticeResult>;

export interface PracticeSubmitResult {
  ok: boolean;
  reason?: string;
  result?: PracticeResult;
  idempotentReplay?: boolean; // true when a prior submission of the same attemptId was replayed
}

// Self-scoped practice port: a persona practices only its own enrolled activities. The view
// returned by getPractice never contains correct answers; scoring happens on submit.
export interface PracticePort {
  getPractice(viewer: IiosGrantedContext, activityId: string): Promise<PracticeActivityView | null>;
  submitPractice(
    viewer: IiosGrantedContext,
    activityId: string,
    submission: PracticeSubmission,
  ): Promise<PracticeSubmitResult>;
}
