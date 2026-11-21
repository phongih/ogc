import { refreshLearningState } from "../../lib/invalidate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InterventionInput } from "@ogc/contracts";
import type { RecordAttendanceInput } from "@ogc/contracts";
import { attendance, teacher, teacherIntelligence, appliedRecommendation } from "../../lib/api";

export const useTeacherDashboard = (personaId: string) =>
  useQuery({ queryKey: ["teacher", personaId], queryFn: () => teacher.getDashboard(personaId) });

export const useClassRoster = (classId: string) =>
  useQuery({ queryKey: ["roster", classId], queryFn: () => teacher.getClassRoster(classId) });

// P2 · session attendance (owning teacher only; mock adapter).
export const useClassAttendance = (personaId: string, classId: string) =>
  useQuery({
    queryKey: ["attendance-summary", personaId, classId],
    queryFn: () => attendance.getClassSummary(personaId, classId),
    enabled: personaId.length > 0 && classId.length > 0,
  });

export const useClassSessions = (personaId: string, classId: string) =>
  useQuery({
    queryKey: ["attendance-sessions", personaId, classId],
    queryFn: () => attendance.listClassSessions(personaId, classId),
    enabled: personaId.length > 0 && classId.length > 0,
  });

export const useSessionAttendance = (personaId: string, sessionId: string) =>
  useQuery({
    queryKey: ["attendance-session", personaId, sessionId],
    queryFn: () => attendance.getSessionAttendance(personaId, sessionId),
    enabled: personaId.length > 0 && sessionId.length > 0,
  });

export const useSessionsToMark = (personaId: string) =>
  useQuery({
    queryKey: ["attendance-to-mark", personaId],
    queryFn: () => attendance.listToMark(personaId),
    enabled: personaId.length > 0,
  });

// Marks feed the support queue (attendance-v1), so a save refreshes every derived view.
export const useRecordAttendance = (personaId: string, sessionId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordAttendanceInput) => attendance.recordAttendance(personaId, sessionId, input),
    onSuccess: () => refreshLearningState(qc),
  });
};

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
    onSuccess: () => refreshLearningState(qc),
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
    onSuccess: () => refreshLearningState(qc),
  });
};

export const useRevertApplied = (viewerPersonaId: string, learnerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => appliedRecommendation.revertApplied(viewerPersonaId, learnerId),
    onSuccess: () => refreshLearningState(qc),
  });
};
