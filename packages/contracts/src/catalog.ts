import { z } from "zod";
import { Id } from "./common.js";

export const CourseLevel = z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]);
export type CourseLevel = z.infer<typeof CourseLevel>;

export const CourseFormat = z.enum(["in_center", "online", "hybrid"]);
export type CourseFormat = z.infer<typeof CourseFormat>;

export const EnrollmentState = z.enum(["not_enrolled", "enrolled", "in_progress", "completed"]);
export type EnrollmentState = z.infer<typeof EnrollmentState>;

export const Course = z.object({
  id: Id,
  orgId: Id, // belongs to the tenant root
  brandId: Id,
  code: z.string().min(2),
  title: z.string().min(1),
  level: CourseLevel,
  objectives: z.array(z.string()).min(1),
  durationWeeks: z.number().int().positive(),
  format: CourseFormat,
});
export type Course = z.infer<typeof Course>;

export interface CourseFilter {
  level?: CourseLevel;
  format?: CourseFormat;
  q?: string;
}

export interface CatalogPort {
  listCourses(orgId: string, filter?: CourseFilter): Promise<Course[]>;
  getCourse(courseId: string): Promise<Course | null>;
}
