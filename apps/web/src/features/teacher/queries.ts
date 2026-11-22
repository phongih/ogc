import type { IiosGrantedContext } from "@ogc/contracts";
import { refreshLearningState } from "../../lib/invalidate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InterventionInput } from "@ogc/contracts";
import type { RecordAttendanceInput } from "@ogc/contracts";
import { useViewer } from "../../app/iiosGate";
import { attendance, teacher, teacherIntelligence, appliedRecommendation } from "../../lib/api";

export const useTeacherDashboard = (viewer: IiosGrantedContext) =>
  useQuery({ queryKey: ["teacher", viewer], queryFn: () => teacher.getDashboard(viewer) });

export const useClassRoster = (classId: string) =>
  useQuery({ queryKey: ["roster", classId], queryFn: () => teacher.getClassRoster(classId) });

// P2 · session attendance (owning teacher / substitute only; mock adapter). OGC-ADR-039 step 3b:
// the caller is the IIOS-granted context of the current screen.
export const useClassAttendance = (classId: string) => {
  const viewer = useViewer();
  return useQuery({
    queryKey: ["attendance-summary", viewer, classId],
    queryFn: () => attendance.getClassSummary(viewer, classId),
    enabled: classId.length > 0,
  });
};

export const useClassSessions = (classId: string) => {
  const viewer = useViewer();
  return useQuery({
    queryKey: ["attendance-sessions", viewer, classId],
    queryFn: () => attendance.listClassSessions(viewer, classId),
    enabled: classId.length > 0,
  });
};

export const useSessionAttendance = (sessionId: string) => {
  const viewer = useViewer();
  return useQuery({
    queryKey: ["attendance-session", viewer, sessionId],
    queryFn: () => attendance.getSessionAttendance(viewer, sessionId),
    enabled: sessionId.length > 0,
  });
};

export const useSessionsToMark = () => {
  const viewer = useViewer();
  return useQuery({
    queryKey: ["attendance-to-mark", viewer],
    queryFn: () => attendance.listToMark(viewer),
  });
};

// Marks feed the support queue (attendance-v1), so a save refreshes every derived view.
export const useRecordAttendance = (sessionId: string) => {
  const qc = useQueryClient();
  const viewer = useViewer();
  return useMutation({
    mutationFn: (input: RecordAttendanceInput) =>
      attendance.recordAttendance(viewer, sessionId, input),
    onSuccess: () => refreshLearningState(qc),
  });
};

// LI-4 — teacher learning-intelligence view + intervention.
export const useTeacherLearnerView = (viewer: IiosGrantedContext, learnerId: string) =>
  useQuery({
    queryKey: ["ti-view", viewer, learnerId],
    queryFn: () => teacherIntelligence.getLearnerView(viewer, learnerId),
    enabled: !!viewer && learnerId.length > 0,
  });

export const useInterventions = (viewer: IiosGrantedContext, learnerId: string) =>
  useQuery({
    queryKey: ["ti-interventions", viewer, learnerId],
    queryFn: () => teacherIntelligence.listInterventions(viewer, learnerId),
    enabled: !!viewer && learnerId.length > 0,
  });

export const useIntervene = (viewer: IiosGrantedContext, learnerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InterventionInput) =>
      teacherIntelligence.intervene(viewer, learnerId, input),
    onSuccess: () => refreshLearningState(qc),
  });
};

// AUTH-026 — applied teacher recommendation (reaches the learner).
export const useActiveApplied = (viewer: IiosGrantedContext, learnerId: string) =>
  useQuery({
    queryKey: ["applied-active", viewer, learnerId],
    queryFn: () => appliedRecommendation.getActiveApplied(viewer, learnerId),
    enabled: !!viewer && learnerId.length > 0,
  });

export const useApplyRecommendation = (viewer: IiosGrantedContext, learnerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InterventionInput) =>
      appliedRecommendation.applyRecommendation(viewer, learnerId, input),
    onSuccess: () => refreshLearningState(qc),
  });
};

export const useRevertApplied = (viewer: IiosGrantedContext, learnerId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => appliedRecommendation.revertApplied(viewer, learnerId),
    onSuccess: () => refreshLearningState(qc),
  });
};
