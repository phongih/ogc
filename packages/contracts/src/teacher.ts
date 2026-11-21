import { z } from "zod";
import { Id } from "./common.js";

export const ClassSummary = z.object({
  id: Id,
  orgId: Id,
  centerId: Id,
  courseId: Id,
  name: z.string().min(1),
  learnerCount: z.number().int().nonnegative(),
  nextSessionAt: z.string().nullable(),
});
export type ClassSummary = z.infer<typeof ClassSummary>;

export const LearnerRow = z.object({
  learnerId: Id,
  displayName: z.string().min(1),
  progressPct: z.number().min(0).max(100),
});
export type LearnerRow = z.infer<typeof LearnerRow>;

export const Session = z.object({
  id: z.string().min(1),
  classId: Id,
  title: z.string().min(1),
  at: z.string(),
  asSubstitute: z.boolean().optional(), // P2: the viewer teaches this one session as a substitute
  coveredBy: z.string().optional(), // P2: a substitute teaches this session of the viewer's class
  makeup: z.boolean().optional(), // P2: a make-up session (booked guests only)
});
export type Session = z.infer<typeof Session>;

export const TeacherDashboard = z.object({
  teacherId: Id,
  teacherName: z.string().min(1),
  orgId: Id,
  classes: z.array(ClassSummary),
  upcoming: z.array(Session),
});
export type TeacherDashboard = z.infer<typeof TeacherDashboard>;

export interface TeacherPort {
  getDashboard(personaId: string): Promise<TeacherDashboard | null>;
  getClassRoster(classId: string): Promise<LearnerRow[]>;
}
