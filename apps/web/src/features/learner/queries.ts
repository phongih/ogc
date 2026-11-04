import { useQuery } from "@tanstack/react-query";
import {
  learner,
  profile,
  recommendation,
  masteryConfidence,
  justifiedRecommendation,
  learningPath,
  learnerNextAction,
} from "../../lib/api";
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

// LI-2 — evidence quality: confidence per skill + evidence-justified next step.
export const useMasteryConfidence = (personaId: string) =>
  useQuery({
    queryKey: ["li-confidence", personaId],
    queryFn: () => masteryConfidence.getConfidence(personaId),
    enabled: personaId.length > 0,
  });

export const useJustifiedRecommendation = (personaId: string) =>
  useQuery({
    queryKey: ["li-justified", personaId],
    queryFn: () => justifiedRecommendation.getJustified(personaId),
    enabled: personaId.length > 0,
  });

// LI-3 — prerequisite-governed learning path (steps + prerequisite-aware next step).
export const useLearningPath = (personaId: string) =>
  useQuery({
    queryKey: ["li-path", personaId],
    queryFn: () => learningPath.getLearningPath(personaId),
    enabled: personaId.length > 0,
  });

// AUTH-026 — the learner's single next action (teacher-applied or system), learner-friendly.
export const useNextAction = (personaId: string) =>
  useQuery({
    queryKey: ["li-next-action", personaId],
    queryFn: () => learnerNextAction.getNextAction(personaId),
    enabled: personaId.length > 0,
  });
