import type { IiosGrantedContext } from "@ogc/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LessonPlanDraft } from "@ogc/contracts";
import { lessonPlan } from "../../lib/api";

export const usePlansForClass = (viewer: IiosGrantedContext, classId: string) =>
  useQuery({
    queryKey: ["lessonplan", "class", viewer, classId],
    queryFn: () => lessonPlan.listForClass(viewer, classId),
    enabled: !!viewer && classId.length > 0,
  });

export function useSavePlan(viewer: IiosGrantedContext, classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: LessonPlanDraft) => lessonPlan.save(viewer, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lessonplan", "class", viewer, classId] }),
  });
}
