import { z } from "zod";
import { Id } from "./common.js";
import { Skill } from "./profile.js";

/*
 * P1 · "Learners needing support" queue for the owning teacher — ADDITIVE, SYNTHETIC.
 *
 * Owner decision (21/11): evidence first. Every flag states its reason AND its source, so a
 * teacher can tell a placement-only estimate from a result the learner actually produced.
 * Flags carry no new model: they read the same LI-1 mastery fold the learner already sees.
 * Acting on a flag reuses AUTH-026 (applied recommendation); nothing here changes mastery.
 */

export const SupportSignalKind = z.enum([
  "low_skill", // a skill below the support threshold
  "skill_drop", // the latest evidence on a skill lowered it by ≥ the drop threshold
  "speaking_returned", // the teacher returned a speaking rehearsal for another try
]);
export type SupportSignalKind = z.infer<typeof SupportSignalKind>;

// Where the signal comes from — shown to the teacher verbatim.
export const SupportSource = z.enum(["placement", "practice", "teacher_review"]);
export type SupportSource = z.infer<typeof SupportSource>;

export const SupportSignal = z.object({
  kind: SupportSignalKind,
  source: SupportSource,
  skill: Skill.optional(),
  level: z.number().min(0).max(100).optional(),
  delta: z.number().optional(), // negative for a drop
  evidenceCount: z.number().int().nonnegative().optional(),
});
export type SupportSignal = z.infer<typeof SupportSignal>;

export const SupportItem = z.object({
  learnerId: Id,
  learnerName: z.string().min(1),
  className: z.string().min(1),
  signals: z.array(SupportSignal).min(1),
  evidenceBacked: z.boolean(), // at least one signal NOT from placement alone
  focusSkill: Skill.nullable(),
  suggestedActivityId: z.string().nullable(), // an AVAILABLE activity on the focus skill
  suggestedTitle: z.string().nullable(),
  activeAssignmentTitle: z.string().nullable(), // AUTH-026 applied recommendation, if any
});
export type SupportItem = z.infer<typeof SupportItem>;

// Owning-teacher + same-tenant scoped; non-teachers and unrelated teachers get [].
export interface SupportPort {
  listNeedsSupport(viewerPersonaId: string): Promise<SupportItem[]>;
}
