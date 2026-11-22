import type { IiosGrantedContext } from "@ogc/contracts";
import { refreshLearningState } from "../../../lib/invalidate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PracticeSubmission } from "@ogc/contracts";
import { speaking } from "../../../lib/api";

// P1 · Speaking studio (mock). Learner + reviewing-teacher hooks.

export const useSpeakingStudio = (viewer: IiosGrantedContext, activityId: string) =>
  useQuery({
    queryKey: ["speaking", "studio", viewer, activityId],
    queryFn: () => speaking.getStudio(viewer, activityId),
    enabled: !!viewer && activityId.length > 0,
  });

export const useMySpeakingFeedback = (
  viewer: IiosGrantedContext,
  activityId: string,
  enabled = true,
) =>
  useQuery({
    queryKey: ["speaking", "feedback", viewer, activityId],
    queryFn: () => speaking.getMyFeedback(viewer, activityId),
    enabled: enabled && !!viewer && activityId.length > 0,
  });

export function useSubmitRehearsal(viewer: IiosGrantedContext, activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submission: PracticeSubmission) =>
      speaking.submitRehearsal(viewer, activityId, submission),
    // A rehearsal does not touch mastery (pending review) — only the speaking views refresh.
    onSuccess: () => qc.invalidateQueries({ queryKey: ["speaking"] }),
  });
}

export const usePendingSpeakingReviews = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["speaking", "pending", viewer],
    queryFn: () => speaking.listPendingReviews(viewer),
    enabled: !!viewer,
  });

export function useReviewSpeaking(viewer: IiosGrantedContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: {
      learnerId: string;
      activityId: string;
      decision: "approve" | "return";
      note?: string;
    }) =>
      a.decision === "approve"
        ? speaking.approve(viewer, a.learnerId, a.activityId)
        : speaking.returnForRetry(viewer, a.learnerId, a.activityId, a.note ?? ""),
    // Approval writes a completed attempt → mastery, path, next action and progress all change.
    onSuccess: () => refreshLearningState(qc),
  });
}
