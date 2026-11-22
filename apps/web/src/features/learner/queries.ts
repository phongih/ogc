import type { IiosGrantedContext } from "@ogc/contracts";
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

export const useLearnerDashboard = (viewer: IiosGrantedContext) =>
  useQuery({ queryKey: ["learner", viewer], queryFn: () => learner.getDashboard(viewer) });

// LI-1 — learner intelligence: mastery profile + evidence-driven next step.
export const useLearnerProfile = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["li-profile", viewer],
    queryFn: () => profile.getProfile(viewer),
    enabled: !!viewer,
  });

export const useRecommendation = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["li-recommendation", viewer],
    queryFn: () => recommendation.getRecommendation(viewer),
    enabled: !!viewer,
  });

// LI-2 — evidence quality: confidence per skill + evidence-justified next step.
export const useMasteryConfidence = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["li-confidence", viewer],
    queryFn: () => masteryConfidence.getConfidence(viewer),
    enabled: !!viewer,
  });

export const useJustifiedRecommendation = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["li-justified", viewer],
    queryFn: () => justifiedRecommendation.getJustified(viewer),
    enabled: !!viewer,
  });

// LI-3 — prerequisite-governed learning path (steps + prerequisite-aware next step).
export const useLearningPath = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["li-path", viewer],
    queryFn: () => learningPath.getLearningPath(viewer),
    enabled: !!viewer,
  });

// AUTH-026 — the learner's single next action (teacher-applied or system), learner-friendly.
export const useNextAction = (viewer: IiosGrantedContext) =>
  useQuery({
    queryKey: ["li-next-action", viewer],
    queryFn: () => learnerNextAction.getNextAction(viewer),
    enabled: !!viewer,
  });
