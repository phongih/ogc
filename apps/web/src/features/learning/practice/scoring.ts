import type {
  PracticeActivity,
  PracticeItemResult,
  PracticeResult,
  PracticeSubmission,
} from "@ogc/contracts";
import { PRACTICE_SCORING_VERSION } from "../intelligence/practiceVersion";

/*
 * OGC-AUTH-030 — Pure, deterministic practice scorer. No randomness, no model, no I/O.
 * score = round(correct / total * 100). Unanswered items count as incorrect. The result is
 * fully determined by (activity, submission), so the same inputs always yield the same score.
 */

export { PRACTICE_SCORING_VERSION };

export function scorePractice(
  activity: PracticeActivity,
  learnerId: string,
  submission: PracticeSubmission,
): PracticeResult {
  // Last response per item wins (deterministic de-dupe); ignore responses to unknown items.
  const chosen = new Map<string, string>();
  const itemIds = new Set(activity.items.map((i) => i.id));
  for (const r of submission.responses) {
    if (itemIds.has(r.itemId)) chosen.set(r.itemId, r.optionId);
  }

  const items: PracticeItemResult[] = activity.items.map((item) => {
    const chosenOptionId = chosen.get(item.id) ?? null;
    return {
      itemId: item.id,
      chosenOptionId,
      correctOptionId: item.correctOptionId,
      correct: chosenOptionId === item.correctOptionId,
    };
  });

  const total = activity.items.length;
  const correct = items.filter((i) => i.correct).length;
  const score = Math.round((correct / total) * 100);

  return {
    activityId: activity.activityId,
    learnerId,
    skill: activity.skill,
    score,
    correct,
    total,
    scoringVersion: activity.scoringVersion || PRACTICE_SCORING_VERSION,
    items,
  };
}
