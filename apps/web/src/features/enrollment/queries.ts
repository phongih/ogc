import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enrollment } from "../../lib/api";

export const useEnrollmentState = (personaId: string, courseId: string) =>
  useQuery({
    queryKey: ["enrollment", "state", personaId, courseId],
    queryFn: () => enrollment.getState(personaId, courseId),
    enabled: personaId.length > 0 && courseId.length > 0,
  });

export const useMyEnrollments = (personaId: string) =>
  useQuery({
    queryKey: ["enrollment", "list", personaId],
    queryFn: () => enrollment.listMyEnrollments(personaId),
    enabled: personaId.length > 0,
  });

export function useEnroll(personaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => enrollment.enroll(personaId, courseId),
    onSuccess: () => {
      // Enrollment store is shared: refresh enrollment state and the learner dashboard (My Learning).
      qc.invalidateQueries({ queryKey: ["enrollment"] });
      qc.invalidateQueries({ queryKey: ["learner", personaId] });
    },
  });
}
