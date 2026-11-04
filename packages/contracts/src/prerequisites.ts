import { z } from "zod";
import { Id } from "./common.js";

/*
 * LEARNER INTELLIGENCE — Prerequisite graph (LI-3). ADDITIVE.
 *
 * Prerequisites are modeled as a SEPARATE relation, NOT as a field on LearningActivity, so
 * no existing public type or port signature changes. An edge says "activityId requires all
 * of requiresActivityIds to be completed first". Edges are org-scoped; a requirement that
 * resolves outside the tenant is rejected (cross_org), never silently followed.
 * NON-PRODUCTION synthetic.
 */
export const ActivityPrerequisite = z.object({
  activityId: z.string().min(1),
  orgId: Id, // tenant root the dependent activity belongs to
  requiresActivityIds: z.array(z.string().min(1)),
});
export type ActivityPrerequisite = z.infer<typeof ActivityPrerequisite>;

// Graph integrity problems — all fail CLOSED (the affected activity never unlocks).
export const GraphIssueKind = z.enum([
  "cycle", // the activity participates in a dependency cycle
  "missing_prerequisite", // requires an id that does not exist in scope
  "cross_org", // requires an id that belongs to another tenant
  "unreachable", // can never become available (depends on a cycle/missing/cross-org edge)
]);
export type GraphIssueKind = z.infer<typeof GraphIssueKind>;

export const GraphIssue = z.object({
  kind: GraphIssueKind,
  activityId: z.string().min(1),
  detail: z.string(),
});
export type GraphIssue = z.infer<typeof GraphIssue>;

export const GraphValidation = z.object({
  valid: z.boolean(), // true only when there are no issues
  issues: z.array(GraphIssue),
});
export type GraphValidation = z.infer<typeof GraphValidation>;

// Self/org-scoped read of the prerequisite edges in a learner's scope. Fail-closed → [].
export interface PrerequisitePort {
  getPrerequisites(personaId: string): Promise<ActivityPrerequisite[]>;
}
