import { useQuery } from "@tanstack/react-query";
import { learner } from "../../lib/api";

export const useLearnerDashboard = (personaId: string) =>
  useQuery({ queryKey: ["learner", personaId], queryFn: () => learner.getDashboard(personaId) });
