import { z } from "zod";
import { Id } from "./common.js";
// Type-only (erased at runtime) — avoids a runtime import cycle with public.ts.
import type { PublicCourse, CatalogPage } from "./public.js";

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

export interface CatalogPageRequest {
  cursor?: string;
  limit?: number;
}

/*
 * The public Catalog boundary speaks the PUBLIC view model (PublicCourse), never the
 * internal Course — the two are kept separate so the public surface carries no internal
 * fields. Organization context is EXPLICIT on every method (scoping, not authorization);
 * `getCourse` is org-scoped so a course id from another tenant is not resolvable.
 */
export interface CatalogPort {
  listCourses(
    orgId: string,
    filter?: CourseFilter,
    page?: CatalogPageRequest,
  ): Promise<CatalogPage>;
  getCourse(orgId: string, courseId: string): Promise<PublicCourse | null>;
}
