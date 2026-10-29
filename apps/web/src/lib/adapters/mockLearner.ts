import type { LearnerPort, LearnerDashboard, EnrolledCourse } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { lessons } from "../../fixtures/learning";
import { courses } from "../../fixtures/catalog";
import { enrollmentStore, learningStore } from "./store";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 100): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export const mockLearner: LearnerPort = {
  getDashboard: (personaId) =>
    withFault("learner.getDashboard", () => {
    const p = personaMap[personaId];
    if (!p || !p.learnerId) return latency(null); // fail-closed: no learner scope for this persona
    const learnerId = p.learnerId;
    // Enrolled courses are derived from the shared enrollment store (reflects new enrollments).
    const enrolled: EnrolledCourse[] = enrollmentStore
      .list(personaId)
      .map((rec) => {
        const course = courses.find((c) => c.id === rec.courseId);
        if (!course) return null;
        const nextLesson = lessons.find((l) => l.courseId === course.id && l.scheduledAt !== null);
        // Progress is the activity-derived value (single source of truth), not the seed.
        const progressPct = learningStore.courseProgress(learnerId, course.id).progressPct;
        return {
          course,
          state: rec.state,
          progressPct,
          nextLessonId: nextLesson?.id ?? null,
        } satisfies EnrolledCourse;
      })
      .filter((x): x is EnrolledCourse => x !== null);

    const dashboard: LearnerDashboard = {
      learnerId: p.learnerId,
      learnerName: "Linh N.",
      orgId: p.orgId,
      enrolled,
      upcoming: lessons.filter(
        (l) => l.scheduledAt !== null && enrolled.some((e) => e.course.id === l.courseId),
      ),
    };
    return latency(dashboard);
    }),
};
