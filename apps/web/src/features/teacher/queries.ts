import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InterventionInput } from "@ogc/contracts";
import { teacher, teacherIntelligence, appliedRecommendation } from "../../lib/api";
import { getClassAttendance } from "./attendance";

export const useTeacherDashboard = (personaId: string) =>
  useQuery({ queryKey: ["teacher", personaId], queryFn: () => teacher.getDashboard(personaId) });

export const useClassRoster = (classId: string) =>
  useQuery({ queryKey: ["roster", classId], queryFn: () => teacher.getClassRoster(classId) });

export const useClassAttendance = (personaId: string, classId: string) =>
  useQuery({
    queryKey: ["attendance", personaId, classId],
    queryFn: async () => getClassAttendance(personaId, classId),
    enabled: personaId.length > 0 && classId.length > 0,
  });

// LI-4 — teacher learning-intelligence view + intervention.
export const useTeacherLearnerView = (viewerPersonaId: string, learnerId: string) =>
  useQuery({
    queryKey: ["ti-view", viewerPersonaId, learnerId],
    queryFn: () => teacherIntelligence.getLearnerView(viewerPersonaId, learnerId),
    enabled: viewerPersonaId.length > 0 && learnerId.length > 0,
  });

export const useInterventions = (viewerPersonaId: string, learnerId: string) =>
  useQuery({
    queryKey: ["ti-interventions", viewerPersonaId, learnerId],
    queryFn: () => teacherIntelligence.listInterventions(viewerPersonaId, learnerId),
    enabled: viewerPersonaId.length > 0 && learnerId.length > 0,
  });

export const useIntervene = (viewerPersonaId: string, learnerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InterventionInput) =>
      teacherIntelligence.intervene(viewerPersonaId, learnerId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ti-interventions", viewerPersonaId, learnerId] }),
  });
};

// AUTH-026 — applied teacher recommendation (reaches the learner).
export const useActiveApplied = (viewerPersonaId: string, learnerId: string) =>
  useQuery({
    queryKey: ["applied-active", viewerPersonaId, learnerId],
    queryFn: () => appliedRecommendation.getActiveApplied(viewerPersonaId, learnerId),
    enabled: viewerPersonaId.length > 0 && learnerId.length > 0,
  });

export const useApplyRecommendation = (viewerPersonaId: string, learnerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InterventionInput) =>
      appliedRecommendation.applyRecommendation(viewerPersonaId, learnerId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["applied-active", viewerPersonaId, learnerId] }),
  });
};

export const useRevertApplied = (viewerPersonaId: string, learnerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => appliedRecommendation.revertApplied(viewerPersonaId, learnerId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["applied-active", viewerPersonaId, learnerId] }),
  });
};
