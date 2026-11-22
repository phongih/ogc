import type { IiosGrantedContext } from "@ogc/contracts";
import { refreshLearningState } from "../../lib/invalidate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { learning, progressView } from "../../lib/api";

export const useActivities = (viewer: IiosGrantedContext, courseId: string) =>
  useQuery({
    queryKey: ["learning", "activities", viewer, courseId],
    queryFn: () => learning.listActivities(viewer, courseId),
    enabled: !!viewer && courseId.length > 0,
  });

export const useCourseProgress = (viewer: IiosGrantedContext, courseId: string) =>
  useQuery({
    queryKey: ["learning", "progress", viewer, courseId],
    queryFn: () => learning.getProgress(viewer, courseId),
    enabled: !!viewer && courseId.length > 0,
  });

export const useMyProgress = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["learning", "myprogress", viewer],
    queryFn: () => learning.listMyProgress(viewer),
    enabled: !!viewer,
  });

export const useActivityAttempts = (viewer: IiosGrantedContext, activityIds: string[]) =>
  useQuery({
    queryKey: ["learning", "attempts", viewer, activityIds],
    queryFn: async () => {
      const entries = await Promise.all(
        activityIds.map(async (id) => [id, await learning.getAttempt(viewer, id)] as const),
      );
      return Object.fromEntries(entries);
    },
    enabled: !!viewer && activityIds.length > 0,
  });

export function useCompleteActivity(viewer: IiosGrantedContext, courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (activityId: string) => learning.completeActivity(viewer, activityId),
    onSuccess: () => {
      // Completion feeds progress across routes/roles: refresh learning + learner dashboard.
      refreshLearningState(qc);
      void courseId;
    },
  });
}

// Cross-role: a teacher/guardian/staff viewer reads a specific learner's progress.
export const useLearnerProgress = (viewer: IiosGrantedContext, learnerId: string) =>
  useQuery({
    queryKey: ["learning", "view", viewer, learnerId],
    queryFn: () => progressView.getLearnerProgress(viewer, learnerId),
    enabled: !!viewer && learnerId.length > 0,
  });

// Overall progress per learner for a class view, each entry authorization-checked.
// A learner the viewer is not authorized to see resolves to null (fail-closed).
export const useClassProgress = (viewer: IiosGrantedContext, learnerIds: string[]) =>
  useQuery({
    queryKey: ["learning", "classview", viewer, learnerIds],
    queryFn: async () => {
      const entries = await Promise.all(
        learnerIds.map(async (id) => {
          const summary = await progressView.getLearnerProgress(viewer, id);
          return [id, summary === null ? null : summary.overallPct] as const; // null = unauthorized
        }),
      );
      return Object.fromEntries(entries) as Record<string, number | null>;
    },
    enabled: !!viewer && learnerIds.length > 0,
  });
