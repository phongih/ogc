import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LessonPlanDraft } from "@ogc/contracts";
import { lessonPlan } from "../../lib/api";

export const usePlansForClass = (personaId: string, classId: string) =>
  useQuery({
    queryKey: ["lessonplan", "class", personaId, classId],
    queryFn: () => lessonPlan.listForClass(personaId, classId),
    enabled: personaId.length > 0 && classId.length > 0,
  });

export function useSavePlan(personaId: string, classId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: LessonPlanDraft) => lessonPlan.save(personaId, draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lessonplan", "class", personaId, classId] }),
  });
}
