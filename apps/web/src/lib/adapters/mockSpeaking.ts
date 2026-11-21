import type {
  PracticeActivityView,
  SpeakingFeedback,
  SpeakingPort,
  SpeakingReviewItem,
  SpeakingReviewResult,
  SpeakingSubmitResult,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { speakingCoachFor, speakingFor } from "../../fixtures/speaking";
import { personaMap } from "../../fixtures/personas";
import { classTeachers, rosters } from "../../fixtures/teaching";
import { learningStore } from "./store";
import { lockedFor, scopeFor, submissionLocked } from "./mockPractice";
import { teacherOwnsLearner } from "./mockProfile";
import { withFault } from "./faults";

/*
 * P1 · Speaking studio — MOCK adapter. NON-PRODUCTION, synthetic: no audio, no ASR, no model.
 * Learner side: self-scoped (own learnerId, own tenant, own enrolled course) — same scope as
 * practice. Teacher side: the viewer must OWN a class whose roster holds the learner, in the
 * same tenant (teacherOwnsLearner, as for AUTH-026). Everything fails closed.
 */

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

function feedbackFor(learnerId: string, activityId: string): SpeakingFeedback | null {
  const s = learningStore.getSpeaking(learnerId, activityId);
  if (!s) return null;
  return { result: s.result, coach: speakingCoachFor(activityId), review: s.review };
}

function ownedLearnerIds(viewerPersonaId: string): string[] {
  const teacherId = personaMap[viewerPersonaId]?.teacherId;
  if (!teacherId) return [];
  const ids = Object.entries(classTeachers)
    .filter(([, t]) => t === teacherId)
    .flatMap(([classId]) => (rosters[classId] ?? []).map((r) => r.learnerId));
  // Re-check each through the shared owning-teacher + same-tenant guard.
  return [...new Set(ids)].filter((id) => teacherOwnsLearner(viewerPersonaId, id) !== null);
}

function learnerName(learnerId: string): string {
  for (const list of Object.values(rosters)) {
    const row = list.find((r) => r.learnerId === learnerId);
    if (row) return row.displayName;
  }
  return "Learner";
}

export const mockSpeaking: SpeakingPort = {
  getStudio: (personaId, activityId) =>
    withFault("speaking.getStudio", () => {
      const script = speakingFor(activityId);
      const scope = scopeFor(personaId, activityId);
      if (!script || !scope) return latency<PracticeActivityView | null>(null);
      // Hard prerequisite gate: a locked activity has no studio yet.
      if (lockedFor(scope.learnerId, personaMap[personaId]!.orgId, activityId))
        return latency<PracticeActivityView | null>(null);
      // Answer-free view: correct replies and coaching are revealed only after submission.
      return latency<PracticeActivityView | null>({
        activityId: script.activityId,
        skill: script.skill,
        title: script.title,
        prompt: script.prompt,
        scoringVersion: script.scoringVersion,
        items: script.items.map((i) => ({
          id: i.id,
          prompt: i.prompt,
          options: i.options.map((o) => ({ ...o })),
        })),
      });
    }),

  submitRehearsal: (personaId, activityId, submission) =>
    withFault("speaking.submitRehearsal", () => {
      const scope = scopeFor(personaId, activityId);
      if (!scope) return latency<SpeakingSubmitResult>({ ok: false, reason: "not_in_scope" });
      if (submissionLocked(personaId, activityId))
        return latency<SpeakingSubmitResult>({ ok: false, reason: "prerequisite_required" });
      const r = learningStore.submitSpeaking(personaId, activityId, submission);
      if (!r.ok) return latency<SpeakingSubmitResult>({ ok: false, reason: r.reason });
      return latency<SpeakingSubmitResult>({
        ok: true,
        idempotentReplay: r.idempotentReplay,
        feedback: feedbackFor(scope.learnerId, activityId) ?? undefined,
      });
    }),

  getMyFeedback: (personaId, activityId) =>
    withFault("speaking.getMyFeedback", () => {
      const scope = scopeFor(personaId, activityId);
      if (!scope) return latency<SpeakingFeedback | null>(null);
      return latency(feedbackFor(scope.learnerId, activityId));
    }),

  listPendingReviews: (viewerPersonaId) =>
    withFault("speaking.listPendingReviews", () => {
      const items: SpeakingReviewItem[] = learningStore
        .listSpeaking(ownedLearnerIds(viewerPersonaId), "pending")
        .flatMap((review) => {
          const s = learningStore.getSpeaking(review.learnerId, review.activityId);
          const script = speakingFor(review.activityId);
          if (!s || !script) return [];
          const coach = speakingCoachFor(review.activityId);
          return [
            {
              review,
              learnerName: learnerName(review.learnerId),
              activityTitle:
                activities.find((a) => a.id === review.activityId)?.title ?? script.title,
              result: s.result,
              turns: script.items.map((item) => {
                const r = s.result.items.find((x) => x.itemId === item.id);
                return {
                  prompt: item.prompt,
                  chosen: item.options.find((o) => o.id === r?.chosenOptionId)?.text ?? null,
                  modelLine: coach.find((c) => c.itemId === item.id)?.modelLine ?? "",
                  natural: r?.correct ?? false,
                };
              }),
            },
          ];
        });
      return latency(items);
    }),

  approve: (viewerPersonaId, learnerId, activityId) =>
    withFault("speaking.approve", () => {
      if (!teacherOwnsLearner(viewerPersonaId, learnerId))
        return latency<SpeakingReviewResult>({ ok: false, reason: "forbidden" });
      return latency<SpeakingReviewResult>(learningStore.approveSpeaking(learnerId, activityId));
    }),

  returnForRetry: (viewerPersonaId, learnerId, activityId, note) =>
    withFault("speaking.returnForRetry", () => {
      if (!teacherOwnsLearner(viewerPersonaId, learnerId))
        return latency<SpeakingReviewResult>({ ok: false, reason: "forbidden" });
      return latency<SpeakingReviewResult>(
        learningStore.returnSpeaking(learnerId, activityId, note),
      );
    }),
};
