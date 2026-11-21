import { refreshLearningState } from "../../../lib/invalidate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PracticeSubmission } from "@ogc/contracts";
import { practice } from "../../../lib/api";

export const usePractice = (personaId: string, activityId: string) =>
  useQuery({
    queryKey: ["practice", "get", personaId, activityId],
    queryFn: () => practice.getPractice(personaId, activityId),
    enabled: personaId.length > 0 && activityId.length > 0,
  });

export function useSubmitPractice(personaId: string, activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submission: PracticeSubmission) =>
      practice.submitPractice(personaId, activityId, submission),
    onSuccess: () => {
      // A practice submission feeds mastery → recommendation → path → next action across roles.
      refreshLearningState(qc);
    },
  });
}
