import type {
  LearningPort,
  ProgressViewPort,
  LearningActivity,
  ProgressSnapshot,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { courses } from "../../fixtures/catalog";
import { classTeachers, rosters } from "../../fixtures/teaching";
import { personaMap } from "../../fixtures/personas";
import { enrollmentStore, learningStore } from "./store";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// Reverse map: learnerId -> backing personaId (only personas carry attempt state).
const personaByLearner: Record<string, string> = Object.entries(personaMap).reduce(
  (acc, [pid, m]) => (m.learnerId ? ((acc[m.learnerId] = pid), acc) : acc),
  {} as Record<string, string>,
);

// Activities for a course, scoped to the persona's organization (fail-closed).
function courseActivitiesFor(personaId: string, courseId: string): LearningActivity[] {
  const org = personaMap[personaId]?.orgId;
  if (!org) return [];
  return activities.filter((a) => a.courseId === courseId && a.orgId === org);
}

function snapshotFor(personaId: string, courseId: string): ProgressSnapshot | null {
  const learnerId = personaMap[personaId]?.learnerId;
  if (!learnerId) return null;
  const course = courses.find((c) => c.id === courseId);
  if (!course) return null;

  const p = learningStore.courseProgress(personaId, courseId);
  return {
    personaId,
    learnerId,
    courseId,
    courseTitle: course.title,
    totalActivities: p.totalActivities,
    completedActivities: p.completedActivities,
    assessedCount: p.assessedCount,
    progressPct: p.progressPct,
    lastActivityAt: p.lastActivityAt,
  };
}

function myProgress(personaId: string): ProgressSnapshot[] {
  if (!personaMap[personaId]?.learnerId) return [];
  return enrollmentStore
    .list(personaId)
    .map((e) => snapshotFor(personaId, e.courseId))
    .filter((s): s is ProgressSnapshot => s !== null);
}

export const mockLearning: LearningPort = {
  listActivities: (personaId, courseId) => latency(courseActivitiesFor(personaId, courseId)),
  getAttempt: (personaId, activityId) => latency(learningStore.getAttempt(personaId, activityId)),
  completeActivity: (personaId, activityId) => latency(learningStore.complete(personaId, activityId)),
  getEvidence: (personaId, activityId) => latency(learningStore.getEvidence(personaId, activityId)),
  getProgress: (personaId, courseId) => latency(snapshotFor(personaId, courseId)),
  listMyProgress: (personaId) => latency(myProgress(personaId)),
};

// ── Cross-role authorization for viewing another learner's progress ───────────
function teacherAuthorized(viewerPersonaId: string, learnerId: string): boolean {
  const teacherId = personaMap[viewerPersonaId]?.teacherId;
  if (!teacherId) return false;
  const ownedClasses = Object.entries(classTeachers)
    .filter(([, t]) => t === teacherId)
    .map(([classId]) => classId);
  return ownedClasses.some((classId) => (rosters[classId] ?? []).some((r) => r.learnerId === learnerId));
}

function guardianAuthorized(viewerPersonaId: string, learnerId: string): boolean {
  return (personaMap[viewerPersonaId]?.linkedLearnerIds ?? []).includes(learnerId);
}

export const mockProgressView: ProgressViewPort = {
  getLearnerProgress: (viewerPersonaId, learnerId) => {
    const viewer = personaMap[viewerPersonaId];
    if (!viewer) return latency<ProgressSnapshot[] | null>(null);

    // Determine authorization by the viewer's role, fail-closed.
    const isSelf = viewer.learnerId === learnerId;
    const isStaff = !viewer.learnerId && !viewer.teacherId && !viewer.guardianId; // org staff/admin
    const authorized =
      isSelf ||
      (isStaff && Object.values(personaMap).some((m) => m.learnerId === learnerId && m.orgId === viewer.orgId)) ||
      teacherAuthorized(viewerPersonaId, learnerId) ||
      guardianAuthorized(viewerPersonaId, learnerId);

    if (!authorized) return latency<ProgressSnapshot[] | null>(null);

    // Progress exists only for a learner that has a backing persona with attempts.
    const targetPersona = personaByLearner[learnerId];
    if (!targetPersona) return latency<ProgressSnapshot[] | null>([]);
    return latency<ProgressSnapshot[] | null>(myProgress(targetPersona));
  },
};
