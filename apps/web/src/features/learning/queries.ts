import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { learning, progressView } from "../../lib/api";

export const useActivities = (personaId: string, courseId: string) =>
  useQuery({
    queryKey: ["learning", "activities", personaId, courseId],
    queryFn: () => learning.listActivities(personaId, courseId),
    enabled: personaId.length > 0 && courseId.length > 0,
  });

export const useCourseProgress = (personaId: string, courseId: string) =>
  useQuery({
    queryKey: ["learning", "progress", personaId, courseId],
    queryFn: () => learning.getProgress(personaId, courseId),
    enabled: personaId.length > 0 && courseId.length > 0,
  });

export const useMyProgress = (personaId: string) =>
  useQuery({
    queryKey: ["learning", "myprogress", personaId],
    queryFn: () => learning.listMyProgress(personaId),
    enabled: personaId.length > 0,
  });

export const useActivityAttempts = (personaId: string, activityIds: string[]) =>
  useQuery({
    queryKey: ["learning", "attempts", personaId, activityIds],
    queryFn: async () => {
      const entries = await Promise.all(
        activityIds.map(async (id) => [id, await learning.getAttempt(personaId, id)] as const),
      );
      return Object.fromEntries(entries);
    },
    enabled: personaId.length > 0 && activityIds.length > 0,
  });

export function useCompleteActivity(personaId: string, courseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (activityId: string) => learning.completeActivity(personaId, activityId),
    onSuccess: () => {
      // Completion feeds progress across routes/roles: refresh learning + learner dashboard.
      qc.invalidateQueries({ queryKey: ["learning"] });
      qc.invalidateQueries({ queryKey: ["learner", personaId] });
      void courseId;
    },
  });
}

// Cross-role: a teacher/guardian/staff viewer reads a specific learner's progress.
export const useLearnerProgress = (viewerPersonaId: string, learnerId: string) =>
  useQuery({
    queryKey: ["learning", "view", viewerPersonaId, learnerId],
    queryFn: () => progressView.getLearnerProgress(viewerPersonaId, learnerId),
    enabled: viewerPersonaId.length > 0 && learnerId.length > 0,
  });

// Overall progress per learner for a class view, each entry authorization-checked.
// A learner the viewer is not authorized to see resolves to null (fail-closed).
export const useClassProgress = (viewerPersonaId: string, learnerIds: string[]) =>
  useQuery({
    queryKey: ["learning", "classview", viewerPersonaId, learnerIds],
    queryFn: async () => {
      const entries = await Promise.all(
        learnerIds.map(async (id) => {
          const snaps = await progressView.getLearnerProgress(viewerPersonaId, id);
          if (snaps === null) return [id, null] as const; // unauthorized
          const overall =
            snaps.length === 0
              ? 0
              : Math.round(snaps.reduce((s, x) => s + x.progressPct, 0) / snaps.length);
          return [id, overall] as const;
        }),
      );
      return Object.fromEntries(entries) as Record<string, number | null>;
    },
    enabled: viewerPersonaId.length > 0 && learnerIds.length > 0,
  });
