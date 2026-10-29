import { z } from "zod";
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
  getState(personaId: string, courseId: string): Promise<EnrollmentState>;
  listMyEnrollments(personaId: string): Promise<EnrollmentRecord[]>;
  // Enroll is idempotent-safe: a second enroll in the same course does not duplicate.
  enroll(personaId: string, courseId: string): Promise<{ enrolled: boolean; reason?: string }>;
}
