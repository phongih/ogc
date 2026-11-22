import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";
import { Course, EnrollmentState } from "./catalog.js";

export const Lesson = z.object({
  id: z.string().min(1),
  courseId: Id,
  title: z.string().min(1),
  scheduledAt: z.string().nullable(), // ISO or null when unscheduled
  durationMin: z.number().int().positive(),
});
export type Lesson = z.infer<typeof Lesson>;

export const EnrolledCourse = z.object({
  course: Course,
  state: EnrollmentState,
  progressPct: z.number().min(0).max(100),
  nextLessonId: z.string().nullable(),
});
export type EnrolledCourse = z.infer<typeof EnrolledCourse>;

export const LearnerDashboard = z.object({
  learnerId: Id,
  learnerName: z.string().min(1),
  orgId: Id,
  enrolled: z.array(EnrolledCourse),
  upcoming: z.array(Lesson),
});
export type LearnerDashboard = z.infer<typeof LearnerDashboard>;

export interface LearnerPort {
  // personaId scopes to a synthetic learner within their organization
  getDashboard(viewer: IiosGrantedContext): Promise<LearnerDashboard | null>;
}
