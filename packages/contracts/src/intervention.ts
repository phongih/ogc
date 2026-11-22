import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";
import { LearnerProfile } from "./profile.js";
import { MasteryConfidence } from "./confidence.js";
import { LearningPathView } from "./path.js";

/*
 * LEARNER INTELLIGENCE — Teacher Intervention & Explainability (LI-4). ADDITIVE.
 *
 * Gives an AUTHORIZED teacher a read-only, auditable synthetic view of a learner's adaptive
 * path, plus a synthetic intervention: recommend an alternative ELIGIBLE activity with a
 * required reason. Interventions never overwrite the system recommendation and never bypass
 * prerequisites or tenant boundaries. NON-PRODUCTION. No change to mastery/confidence/
 * prerequisite semantics — this composes the LI-1/LI-2/LI-3 outputs for one learner.
 */

// The read-only teacher view: everything needed to understand a learner's path, explainably.
export const TeacherLearningView = z.object({
  learnerId: Id,
  orgId: Id,
  profile: LearnerProfile, // mastery by skill
  confidence: MasteryConfidence, // evidence confidence by skill
  path: LearningPathView, // steps + prerequisite status + system nextStep (reason codes)
});
export type TeacherLearningView = z.infer<typeof TeacherLearningView>;

// Structured reason for choosing an alternative activity (required on every intervention).
export const InterventionReasonCode = z.enum([
  "pacing", // adjust speed for this learner
  "remediation", // target a struggling area
  "learner_preference", // accommodate the learner's preference
  "assessment_focus", // steer toward an upcoming assessment
  "other",
]);
export type InterventionReasonCode = z.infer<typeof InterventionReasonCode>;

// Audit event — created on every successful intervention; synthetic in-memory persistence.
export const TeacherIntervention = z.object({
  id: z.string().min(1),
  actorPersonaId: z.string().min(1), // who acted
  teacherId: Id, // the resolved owning teacher
  learnerId: Id,
  orgId: Id,
  systemActivityId: z.string().nullable(), // the preserved system recommendation at action time
  selectedActivityId: z.string().min(1), // the teacher-chosen eligible activity
  reasonCode: InterventionReasonCode,
  note: z.string().min(1), // required free-text reason
  at: z.string(), // deterministic timestamp
});
export type TeacherIntervention = z.infer<typeof TeacherIntervention>;

export interface InterventionInput {
  selectedActivityId: string;
  reasonCode: InterventionReasonCode;
  note: string;
}

export const InterventionResult = z.object({
  ok: z.boolean(),
  reason: z.string().optional(), // denial reason when ok === false (fail-closed)
  intervention: TeacherIntervention.optional(),
});
export type InterventionResult = z.infer<typeof InterventionResult>;

// Viewer-scoped with fail-closed authorization: only the owning teacher of the learner may
// read the view or intervene. Guardian/learner/staff and cross-org teachers are denied.
export interface TeacherLearningIntelligencePort {
  getLearnerView(
    viewer: IiosGrantedContext,
    learnerId: string,
  ): Promise<TeacherLearningView | null>;
  intervene(
    viewer: IiosGrantedContext,
    learnerId: string,
    input: InterventionInput,
  ): Promise<InterventionResult>;
  listInterventions(viewer: IiosGrantedContext, learnerId: string): Promise<TeacherIntervention[]>;
}
