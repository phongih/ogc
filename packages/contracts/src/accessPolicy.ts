import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Access policy — ADDITIVE, SYNTHETIC, mock only. Pattern taken from HealthcareOS HCOS-F2.
 * Since OGC-ADR-039 step 2 the policies live in IIOS (mock); these are the shared shapes.
 *
 * Owner decisions (22/11):
 *  - OGC does NOT create, lock or delete accounts: people and their memberships come from the
 *    organization (EduOS / IIOS, mock here). OGC only lists them read-only and lets an Org Admin
 *    attach an access policy to a membership;
 *  - a policy ONLY NARROWS what the role already allows, never grants more:
 *      effective = role permissions ∩ policy;
 *      no policy → the role's normal access (unchanged behaviour);
 *      with a policy → an action is allowed only if some rule for that action has every
 *      condition matching;
 *  - fail-closed: a policy that is missing or retired leaves that membership with NO access;
 *  - only the Org Admin manages policies, and never their own: an admin cannot attach / detach a
 *    policy on their own membership, nor revise / retire a policy that restricts themselves;
 *  - the action catalog is CLOSED: unknown actions, conditions or fields are refused on save.
 * Every create / revise / retire appends a version (who, when, which rules) — never edited.
 */

export const PolicyAction = z.enum([
  "schedule:manage",
  "makeup:manage",
  "center:setup",
  "engine:manage",
  "attendance:mark",
]);
export type PolicyAction = z.infer<typeof PolicyAction>;

export const CriterionKey = z.enum(["centerId", "sessionRole"]);
export type CriterionKey = z.infer<typeof CriterionKey>;

export const SessionRole = z.enum(["owner", "substitute"]);
export type SessionRole = z.infer<typeof SessionRole>;

export const ReadonlyField = z.enum(["classTeacher", "substitute", "actions"]);
export type ReadonlyField = z.infer<typeof ReadonlyField>;

export interface CatalogEntry {
  action: PolicyAction;
  description: string;
  roles: ("staff" | "teacher")[]; // which roles hold this permission to begin with
  criteria: CriterionKey[];
  readonlyFields: ReadonlyField[];
}

export const POLICY_CATALOG: CatalogEntry[] = [
  {
    action: "schedule:manage",
    description:
      "Reschedule, cancel (with a replacement) and add sessions; assign class teachers and substitutes",
    roles: ["staff"],
    criteria: ["centerId"],
    readonlyFields: ["classTeacher", "substitute"],
  },
  {
    action: "makeup:manage",
    description: "Arrange make-ups: join another class, open a make-up session, assign self-study",
    roles: ["staff"],
    criteria: ["centerId"],
    readonlyFields: [],
  },
  {
    action: "center:setup",
    description: "Set up a new center in the organization (wizard)",
    roles: ["staff"],
    criteria: [],
    readonlyFields: [],
  },
  {
    action: "engine:manage",
    description: "Enable / pause Decision Engine rules and tune them",
    roles: ["staff"],
    criteria: [],
    readonlyFields: ["actions"],
  },
  {
    action: "attendance:mark",
    description: "Mark attendance for a session (as the class teacher or as its substitute)",
    roles: ["teacher"],
    criteria: ["sessionRole"],
    readonlyFields: [],
  },
];

export const CRITERION_LABEL: Record<CriterionKey, string> = {
  centerId: "center",
  sessionRole: "as",
};
export const READONLY_LABEL: Record<ReadonlyField, string> = {
  classTeacher: "class teacher",
  substitute: "substitute",
  actions: "rule actions",
};

export const PolicyRule = z.object({
  action: PolicyAction,
  criteria: z
    .object({
      centerId: z.array(z.string()).min(1).optional(),
      sessionRole: z.array(SessionRole).min(1).optional(),
    })
    .strict()
    .optional(),
  readonlyFields: z.array(ReadonlyField).optional(),
});
export type PolicyRule = z.infer<typeof PolicyRule>;

export const PolicyStatus = z.enum(["active", "retired"]);
export type PolicyStatus = z.infer<typeof PolicyStatus>;

export const PolicyVersion = z.object({
  version: z.number().int().min(1),
  status: PolicyStatus,
  description: z.string().nullable(),
  rules: z.array(PolicyRule),
  changedBy: z.string(), // display name of the admin
  changedAt: z.string(),
  change: z.enum(["created", "revised", "retired"]),
});
export type PolicyVersion = z.infer<typeof PolicyVersion>;

export const AccessPolicy = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: PolicyStatus,
  rules: z.array(PolicyRule),
  version: z.number().int().min(1),
  updatedAt: z.string(),
  inUse: z.number().int(), // memberships using it
  restrictsYou: z.boolean(),
  history: z.array(PolicyVersion),
});
export type AccessPolicy = z.infer<typeof AccessPolicy>;

export const MembershipRole = z.enum(["admin", "staff", "teacher", "learner", "guardian"]);
export type MembershipRole = z.infer<typeof MembershipRole>;

export const Membership = z.object({
  principalId: z.string(), // IIOS principal (OGC-ADR-039: members are identified by IIOS)
  displayName: z.string(),
  role: MembershipRole.nullable(), // null: in the organization but no OGC role — can use nothing
  policyId: z.string().nullable(),
  policyName: z.string().nullable(),
  canHavePolicy: z.boolean(), // admin / staff / teacher
  isYou: z.boolean(),
});
export type Membership = z.infer<typeof Membership>;

export interface AccessStats {
  members: number;
  staffAndTeachers: number;
  privileged: number; // Org Admins
  restricted: number; // memberships with a policy
  noRole: number;
}

export interface AccessAdminView {
  orgId: string;
  orgName: string;
  stats: AccessStats;
  policies: AccessPolicy[];
  memberships: Membership[];
  centers: { id: string; name: string }[]; // values for the centerId condition
}

export const PolicyRefusal = z.enum([
  "not_admin",
  "not_found",
  "invalid", // see `detail` (+ `path`)
  "name_taken",
  "stale", // expectedVersion is not the current version
  "retired", // a retired policy is final
  "in_use", // cannot retire while memberships use it
  "self", // cannot change your own membership, or a policy that restricts you
  "not_applicable", // learners / guardians / no-role memberships take no policy
]);
export type PolicyRefusal = z.infer<typeof PolicyRefusal>;

export type PolicyResult =
  | { ok: true; view: AccessAdminView }
  | { ok: false; reason: PolicyRefusal; detail?: string; path?: string };

export interface PolicyInput {
  name: string;
  description?: string | null;
  rules: PolicyRule[];
}

/** What the signed-in persona's own policy leaves them (UI hints; adapters enforce). */
export interface MyAccess {
  policyName: string | null; // null: not restricted
  failedClosed: boolean; // policy missing / retired → nothing allowed
  allowed: Record<PolicyAction, boolean>; // at least one matching rule could apply
  centers: Partial<Record<PolicyAction, string[] | "any">>; // centerId scope per action
  readonly: Partial<Record<PolicyAction, ReadonlyField[]>>;
}

/*
 * OGC-ADR-039 step 2: policies are stored and decided by IIOS (`IiosPolicyAdminPort` in
 * iiosContext.ts). OGC keeps only this read: what the signed-in persona's GRANTED narrowing leaves
 * them, as UI hints. Adapters enforce through `authorize()`.
 */
export interface MyAccessPort {
  myAccess(viewer: IiosGrantedContext): Promise<MyAccess>;
}
