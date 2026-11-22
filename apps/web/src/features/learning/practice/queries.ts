import type { IiosGrantedContext } from "@ogc/contracts";
import { refreshLearningState } from "../../../lib/invalidate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PracticeSubmission } from "@ogc/contracts";
import { practice } from "../../../lib/api";

export const usePractice = (viewer: IiosGrantedContext, activityId: string) =>
  useQuery({
    queryKey: ["practice", "get", viewer, activityId],
    queryFn: () => practice.getPractice(viewer, activityId),
    enabled: !!viewer && activityId.length > 0,
  });

export function useSubmitPractice(viewer: IiosGrantedContext, activityId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submission: PracticeSubmission) =>
      practice.submitPractice(viewer, activityId, submission),
    onSuccess: () => {
      // A practice submission feeds mastery → recommendation → path → next action across roles.
      refreshLearningState(qc);
    },
  });
}
