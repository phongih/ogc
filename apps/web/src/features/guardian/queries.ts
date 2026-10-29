import { useQuery } from "@tanstack/react-query";
import { guardian } from "../../lib/api";

export const useGuardianDashboard = (personaId: string) =>
  useQuery({
    queryKey: ["guardian", personaId],
    queryFn: () => guardian.getDashboard(personaId),
    enabled: personaId.length > 0,
  });
