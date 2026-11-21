import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PracticeSubmission } from "@ogc/contracts";
import { speaking } from "../../../lib/api";

// P1 · Speaking studio (mock). Learner + reviewing-teacher hooks.

export const useSpeakingStudio = (personaId: string, activityId: string) =>
  useQuery({
    queryKey: ["speaking", "studio", personaId, activityId],
    queryFn: () => speaking.getStudio(personaId, activityId),
    enabled: personaId.length > 0 && activityId.length > 0,
  });

export const useMySpeakingFeedback = (personaId: string, activityId: string, enabled = true) =>
  useQuery({
    queryKey: ["speaking", "feedback", personaId, activityId],
    queryFn: () => speaking.getMyFeedback(personaId, activityId),
    enabled: enabled && personaId.length > 0 && activityId.length > 0,
  });

export function useSubmitRehearsal(personaId: string, activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submission: PracticeSubmission) =>
      speaking.submitRehearsal(personaId, activityId, submission),
    // A rehearsal does not touch mastery (pending review) — only the speaking views refresh.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["speaking"] }),
  });
}

export const usePendingSpeakingReviews = (viewerPersonaId: string) =>
  useQuery({
    queryKey: ["speaking", "pending", viewerPersonaId],
    queryFn: () => speaking.listPendingReviews(viewerPersonaId),
    enabled: viewerPersonaId.length > 0,
  });

export function useReviewSpeaking(viewerPersonaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: {
      learnerId: string;
      activityId: string;
      decision: "approve" | "return";
      note?: string;
    }) =>
      a.decision === "approve"
        ? speaking.approve(viewerPersonaId, a.learnerId, a.activityId)
        : speaking.returnForRetry(viewerPersonaId, a.learnerId, a.activityId, a.note ?? ""),
    // Approval writes a completed attempt → mastery, path, next action and progress all change.
    onSuccess: () => qc.invalidateQueries(),
  });
}
