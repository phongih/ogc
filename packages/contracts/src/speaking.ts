import { z } from "zod";
import { Id } from "./common.js";
import type { PracticeActivityView, PracticeResult, PracticeSubmission } from "./practice.js";

/*
 * P1 · Speaking studio (MOCK) — ADDITIVE, SYNTHETIC.
 *
 * Role-play rehearsal: each turn the coach says a line, the learner picks the most natural reply
 * and says it aloud. NO audio is captured, NO ASR, NO LLM — feedback is authored fixture content.
 * Scoring reuses the deterministic practice scorer. Per vision principle 04 ("AI advises;
 * educators govern") a rehearsal does NOT count toward Speaking mastery until a teacher who owns
 * the learner approves it. Until then it is a pending review; the teacher may return it for retry.
 */

// Authored coaching for one turn (shown AFTER the learner submits the rehearsal).
export const SpeakingTip = z.object({
  focus: z.string().min(1), // word or phrase to practise
  ipa: z.string().min(1), // pronunciation guide (broad IPA)
  tip: z.string().min(1), // one short, actionable hint
});
export type SpeakingTip = z.infer<typeof SpeakingTip>;

export const SpeakingTurnCoach = z.object({
  itemId: z.string().min(1),
  modelLine: z.string().min(1), // a natural way to say the reply
  tips: z.array(SpeakingTip),
});
export type SpeakingTurnCoach = z.infer<typeof SpeakingTurnCoach>;

export const SpeakingReviewStatus = z.enum(["pending", "approved", "returned"]);
export type SpeakingReviewStatus = z.infer<typeof SpeakingReviewStatus>;

export const SpeakingReview = z.object({
  learnerId: Id,
  orgId: Id,
  activityId: z.string().min(1),
  attemptId: z.string().min(1),
  status: SpeakingReviewStatus,
  submittedAt: z.string().min(1),
  reviewedAt: z.string().nullable(),
  reviewerNote: z.string().nullable(), // required when returned
});
export type SpeakingReview = z.infer<typeof SpeakingReview>;

// What the learner gets back after submitting a rehearsal: the scored result, the coaching
// (now safe to reveal) and the review state.
export interface SpeakingFeedback {
  result: PracticeResult;
  coach: SpeakingTurnCoach[];
  review: SpeakingReview;
}

export interface SpeakingSubmitResult {
  ok: boolean;
  reason?: string;
  feedback?: SpeakingFeedback;
  idempotentReplay?: boolean;
}

// A pending rehearsal as the reviewing teacher sees it.
export interface SpeakingReviewItem {
  review: SpeakingReview;
  learnerName: string;
  activityTitle: string;
  result: PracticeResult;
  turns: { prompt: string; chosen: string | null; modelLine: string; natural: boolean }[];
}

export interface SpeakingReviewResult {
  ok: boolean;
  reason?: string;
  review?: SpeakingReview;
}

// Learner side is self-scoped (own enrolled activities); teacher side is owning-teacher +
// same-tenant scoped. Every method fails closed.
export interface SpeakingPort {
  getStudio(personaId: string, activityId: string): Promise<PracticeActivityView | null>;
  submitRehearsal(
    personaId: string,
    activityId: string,
    submission: PracticeSubmission,
  ): Promise<SpeakingSubmitResult>;
  getMyFeedback(personaId: string, activityId: string): Promise<SpeakingFeedback | null>;
  listPendingReviews(viewerPersonaId: string): Promise<SpeakingReviewItem[]>;
  approve(
    viewerPersonaId: string,
    learnerId: string,
    activityId: string,
  ): Promise<SpeakingReviewResult>;
  returnForRetry(
    viewerPersonaId: string,
    learnerId: string,
    activityId: string,
    note: string,
  ): Promise<SpeakingReviewResult>;
}
