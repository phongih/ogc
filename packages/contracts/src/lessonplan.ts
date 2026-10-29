import { z } from "zod";
import { Id } from "./common.js";

export const LessonPlanStatus = z.enum(["draft", "ready"]);
export type LessonPlanStatus = z.infer<typeof LessonPlanStatus>;

export const Activity = z.object({
  title: z.string(),
  durationMin: z.number().int().nonnegative(),
});
export type Activity = z.infer<typeof Activity>;

export const LessonPlan = z.object({
  id: z.string().min(1),
  orgId: Id,
  classId: Id,
  teacherId: Id, // owner; editing is scoped to this teacher
  title: z.string(),
  objectives: z.array(z.string()),
  activities: z.array(Activity),
  resources: z.array(z.string()),
  assessment: z.string(),
  status: LessonPlanStatus,
});
export type LessonPlan = z.infer<typeof LessonPlan>;

export type LessonPlanDraft = Omit<LessonPlan, "orgId" | "teacherId">;

export interface LessonPlanPort {
  listForClass(personaId: string, classId: string): Promise<LessonPlan[]>;
  get(personaId: string, planId: string): Promise<LessonPlan | null>;
  // Save is scoped to the persona's assigned teacher/classes; returns validation errors
  // (empty array = saved). Setting status 'ready' enforces completeness.
  save(personaId: string, draft: LessonPlanDraft): Promise<{ saved: boolean; errors: string[] }>;
}
