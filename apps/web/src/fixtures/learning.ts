import type { Lesson, EnrolledCourse } from "@ogc/contracts";
import { courses } from "./catalog";
import { A2_MORNING_NEXT, B1_EVENING_NEXT } from "./demoClock";

// Deterministic synthetic lessons for the demo learner.
export const lessons: Lesson[] = [
  {
    id: "LSN-A2-07",
    courseId: courses[0].id,
    title: "Unit 7 — Making plans",
    scheduledAt: A2_MORNING_NEXT,
    durationMin: 90,
  },
  {
    id: "LSN-B1-03",
    courseId: courses[1].id,
    title: "Unit 3 — Giving opinions",
    scheduledAt: B1_EVENING_NEXT,
    durationMin: 90,
  },
  {
    id: "LSN-A2-08",
    courseId: courses[0].id,
    title: "Unit 8 — At the market",
    scheduledAt: null,
    durationMin: 90,
  },
];

export const learnerEnrollments: EnrolledCourse[] = [
  { course: courses[0], state: "in_progress", progressPct: 62, nextLessonId: "LSN-A2-07" },
  { course: courses[1], state: "enrolled", progressPct: 8, nextLessonId: "LSN-B1-03" },
];
