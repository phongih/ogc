import { useQuery } from "@tanstack/react-query";
import { learner } from "../../lib/api";
import { getAchievements } from "./achievements";

export const useLearnerDashboard = (personaId: string) =>
  useQuery({ queryKey: ["learner", personaId], queryFn: () => learner.getDashboard(personaId) });

export const useAchievements = (personaId: string) =>
  useQuery({
    queryKey: ["achievements", personaId],
    queryFn: async () => getAchievements(personaId),
    enabled: personaId.length > 0,
  });
