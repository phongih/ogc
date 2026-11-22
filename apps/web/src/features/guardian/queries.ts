import type { IiosGrantedContext } from "@ogc/contracts";
import { useQuery } from "@tanstack/react-query";
import { guardian } from "../../lib/api";

export const useGuardianDashboard = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["guardian", viewer],
    queryFn: () => guardian.getDashboard(viewer),
    enabled: !!viewer,
  });
