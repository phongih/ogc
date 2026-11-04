import { useQuery } from "@tanstack/react-query";
import { learner, profile, recommendation } from "../../lib/api";
import { getAchievements } from "./achievements";

export const useLearnerDashboard = (personaId: string) =>
  useQuery({ queryKey: ["learner", personaId], queryFn: () => learner.getDashboard(personaId) });

export const useAchievements = (personaId: string) =>
  useQuery({
    queryKey: ["achievements", personaId],
    queryFn: async () => getAchievements(personaId),
    enabled: personaId.length > 0,
  });

// LI-1 — learner intelligence: mastery profile + evidence-driven next step.
export const useLearnerProfile = (personaId: string) =>
  useQuery({
    queryKey: ["li-profile", personaId],
    queryFn: () => profile.getProfile(personaId),
    enabled: personaId.length > 0,
  });

export const useRecommendation = (personaId: string) =>
  useQuery({
    queryKey: ["li-recommendation", personaId],
    queryFn: () => recommendation.getRecommendation(personaId),
    enabled: personaId.length > 0,
  });
