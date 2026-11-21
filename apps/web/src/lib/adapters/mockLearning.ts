import type {
  LearningPort,
  ProgressViewPort,
  LearningActivity,
  ProgressSnapshot,
  ProgressState,
  LearnerProgressSummary,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { courses } from "../../fixtures/catalog";
import { classTeachers, rosters } from "../../fixtures/teaching";
import { personaMap } from "../../fixtures/personas";
import { learnerById } from "../../fixtures/learners";
import { enrollmentStore, learningStore } from "./store";
import { withFault } from "./faults";
import { speakingFor } from "../../fixtures/speaking";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// Activities for a course, scoped to the persona's organization (fail-closed).
function courseActivitiesFor(personaId: string, courseId: string): LearningActivity[] {
  const org = personaMap[personaId]?.orgId;
  if (!org) return [];
  return activities.filter((a) => a.courseId === courseId && a.orgId === org);
}

// Snapshot for a LEARNER (domain subject) in one course.
function snapshotFor(learnerId: string, courseId: string): ProgressSnapshot | null {
  const learner = learnerById[learnerId];
  if (!learner) return null;
  const course = courses.find((c) => c.id === courseId);
  if (!course) return null;
  const p = learningStore.courseProgress(learnerId, courseId);
  return {
    learnerId,
    orgId: learner.orgId,
    courseId,
    courseTitle: course.title,
    state: p.state,
    totalActivities: p.totalActivities,
    completedActivities: p.completedActivities,
    assessedCount: p.assessedCount,
    progressPct: p.progressPct,
    lastActivityAt: p.lastActivityAt,
  };
}

function aggregateState(snaps: ProgressSnapshot[]): ProgressState {
  if (snaps.length === 0 || snaps.every((s) => s.state === "not_started")) return "not_started";
  if (snaps.every((s) => s.state === "completed")) return "completed";
  return "in_progress";
}

function summaryFor(learnerId: string): LearnerProgressSummary {
  const learner = learnerById[learnerId];
  const snaps = (learner?.courseIds ?? [])
    .map((cid) => snapshotFor(learnerId, cid))
    .filter((s): s is ProgressSnapshot => s !== null);
  const overallPct =
    snaps.length === 0 ? 0 : Math.round(snaps.reduce((s, x) => s + x.progressPct, 0) / snaps.length);
  return {
    learnerId,
    orgId: learner?.orgId ?? "",
    courseCount: snaps.length,
    overallPct,
    state: aggregateState(snaps),
    snapshots: snaps,
  };
}

export const mockLearning: LearningPort = {
  listActivities: (personaId, courseId) =>
    withFault("learning.listActivities", () => latency(courseActivitiesFor(personaId, courseId))),

  getAttempt: (personaId, activityId) => {
    const learnerId = personaMap[personaId]?.learnerId;
    return withFault("learning.getAttempt", () =>
      latency(learnerId ? learningStore.getAttempt(learnerId, activityId) : null),
    );
  },

  completeActivity: (personaId, activityId) =>
    withFault("learning.completeActivity", () =>
      // P1 speaking: an activity with a Speaking studio counts ONLY via teacher-approved review,
      // never via a self-declared "Mark complete".
      speakingFor(activityId)
        ? latency({ completed: false, reason: "speaking_requires_review" })
        : latency(learningStore.complete(personaId, activityId)),
    ),

  getEvidence: (personaId, activityId) => {
    const learnerId = personaMap[personaId]?.learnerId;
    return withFault("learning.getEvidence", () =>
      latency(learnerId ? learningStore.getEvidence(learnerId, activityId) : []),
    );
  },

  getProgress: (personaId, courseId) => {
    const learnerId = personaMap[personaId]?.learnerId;
    return withFault("learning.getProgress", () =>
      latency(learnerId ? snapshotFor(learnerId, courseId) : null),
    );
  },

  listMyProgress: (personaId) => {
    const learnerId = personaMap[personaId]?.learnerId;
    if (!learnerId) return withFault("learning.listMyProgress", () => latency<ProgressSnapshot[]>([]));
    // Union of the learner's synthetic courses and any courses the persona has enrolled in.
    const courseIds = new Set<string>(learnerById[learnerId]?.courseIds ?? []);
    for (const e of enrollmentStore.list(personaId)) courseIds.add(e.courseId);
    const snaps = [...courseIds]
      .map((cid) => snapshotFor(learnerId, cid))
      .filter((s): s is ProgressSnapshot => s !== null);
    return withFault("learning.listMyProgress", () => latency(snaps));
  },
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
    const run = (v: LearnerProgressSummary | null) =>
      withFault("progress.getLearnerProgress", () => latency<LearnerProgressSummary | null>(v));
    if (!viewer) return run(null);

    const target = learnerById[learnerId];
    const isSelf = viewer.learnerId === learnerId;
    const isStaff = !viewer.learnerId && !viewer.teacherId && !viewer.guardianId; // org staff/admin
    const authorized =
      isSelf ||
      (isStaff && target?.orgId === viewer.orgId) ||
      teacherAuthorized(viewerPersonaId, learnerId) ||
      guardianAuthorized(viewerPersonaId, learnerId);

    if (!authorized || !target) return run(null);
    return run(summaryFor(learnerId));
  },
};
