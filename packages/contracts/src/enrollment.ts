import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";
import { EnrollmentState } from "./catalog.js";

export const EnrollmentRecord = z.object({
  personaId: z.string().min(1),
  courseId: Id,
  state: EnrollmentState,
  progressPct: z.number().min(0).max(100),
});
export type EnrollmentRecord = z.infer<typeof EnrollmentRecord>;

export interface EnrollmentPort {
  getState(viewer: IiosGrantedContext, courseId: string): Promise<EnrollmentState>;
  listMyEnrollments(viewer: IiosGrantedContext): Promise<EnrollmentRecord[]>;
  // Enroll is idempotent-safe: a second enroll in the same course does not duplicate.
  enroll(
    viewer: IiosGrantedContext,
    courseId: string,
  ): Promise<{ enrolled: boolean; reason?: string }>;
}
