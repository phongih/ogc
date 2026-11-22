import type { IiosGrantedContext } from "@ogc/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enrollment } from "../../lib/api";

export const useEnrollmentState = (viewer: IiosGrantedContext, courseId: string) =>
  useQuery({
    queryKey: ["enrollment", "state", viewer, courseId],
    queryFn: () => enrollment.getState(viewer, courseId),
    enabled: !!viewer && courseId.length > 0,
  });

export const useMyEnrollments = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["enrollment", "list", viewer],
    queryFn: () => enrollment.listMyEnrollments(viewer),
    enabled: !!viewer,
  });

export function useEnroll(viewer: IiosGrantedContext) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (courseId: string) => enrollment.enroll(viewer, courseId),
    onSuccess: () => {
      // Enrollment store is shared: refresh enrollment state and the learner dashboard (My Learning).
      qc.invalidateQueries({ queryKey: ["enrollment"] });
      qc.invalidateQueries({ queryKey: ["learner", viewer] });
    },
  });
}
