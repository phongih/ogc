/*
 * MOCK IIOS — synthetic directory (ADR-040 §3.3). The same principals, organizations, centers and
 * access policies as the demo's in-browser mock IIOS (apps/web/src/lib/integration/), so the two
 * runtimes can be compared. No real person, no real organization.
 */
import type { PolicyRule } from "@ogc/contracts";
import type { PolicyRecord } from "./policies.js";

export const ORG_NOVA = "00000000-0000-4000-8000-000000000001";
export const ORG_LUMEN = "00000000-0000-4000-8000-000000000002";
export const CENTER_D1 = "00000000-0000-4000-8000-000000000c01";
export const CENTER_THU_DUC = "00000000-0000-4000-8000-000000000c02";
export const CENTER_CAU_GIAY = "00000000-0000-4000-8000-000000000c03";
export const CENTER_HAI_CHAU = "00000000-0000-4000-8000-000000000c04";

export interface Org {
  id: string;
  name: string;
  centers: { id: string; name: string }[];
}

export const ORGS: Org[] = [
  {
    id: ORG_NOVA,
    name: "Nova Learning",
    centers: [
      { id: CENTER_D1, name: "Nova English — District 1" },
      { id: CENTER_THU_DUC, name: "Nova English — Thu Duc" },
      { id: CENTER_CAU_GIAY, name: "Nova Juniors — Cau Giay" },
    ],
  },
  {
    id: ORG_LUMEN,
    name: "Lumen Edu",
    centers: [{ id: CENTER_HAI_CHAU, name: "Lumen Academy — Hai Chau" }],
  },
];

export type MemberRole = "admin" | "staff" | "teacher" | "learner" | "guardian";

export interface Member {
  principalId: string;
  orgId: string;
  displayName: string;
  role: MemberRole | null; // null: in the organization, no OGC role → can use nothing
}

export const MEMBERS: Member[] = [
  {
    principalId: "iios-principal-admin-1",
    orgId: ORG_NOVA,
    displayName: "Olivia (Org Admin)",
    role: "admin",
  },
  {
    principalId: "iios-principal-staff-1",
    orgId: ORG_NOVA,
    displayName: "Sam (Org Staff)",
    role: "staff",
  },
  {
    principalId: "iios-principal-teacher-1",
    orgId: ORG_NOVA,
    displayName: "Tara (Teacher)",
    role: "teacher",
  },
  {
    principalId: "iios-principal-teacher-2",
    orgId: ORG_NOVA,
    displayName: "Ben (Teacher)",
    role: "teacher",
  },
  {
    principalId: "iios-principal-learner-1",
    orgId: ORG_NOVA,
    displayName: "Linh (Learner)",
    role: "learner",
  },
  {
    principalId: "iios-principal-learner-2",
    orgId: ORG_NOVA,
    displayName: "Minh (Adult learner)",
    role: "learner",
  },
  {
    principalId: "iios-principal-guardian-1",
    orgId: ORG_NOVA,
    displayName: "Mai (Guardian)",
    role: "guardian",
  },
  {
    principalId: "iios-principal-norole-1",
    orgId: ORG_NOVA,
    displayName: "Quinn (no role)",
    role: null,
  },
  {
    principalId: "iios-principal-staff-org2",
    orgId: ORG_LUMEN,
    displayName: "Staff (Lumen)",
    role: "staff",
  },
  {
    principalId: "iios-principal-learner-org2",
    orgId: ORG_LUMEN,
    displayName: "Learner (Lumen)",
    role: "learner",
  },
];

const SEED_AT = "2026-11-01T02:00:00.000Z";

/** The two policies the demo seeds (same refs, names, rules), version 1 by Olivia. */
export function seedPolicies(): PolicyRecord[] {
  const mk = (
    ref: string,
    name: string,
    description: string,
    rules: PolicyRule[],
  ): PolicyRecord => ({
    ref,
    orgId: ORG_NOVA,
    name,
    description,
    version: 1,
    status: "active",
    rules,
    updatedAt: SEED_AT,
    history: [
      {
        version: 1,
        status: "active",
        description,
        rules,
        changedBy: "Olivia (Org Admin)",
        changedAt: SEED_AT,
        change: "created",
      },
    ],
  });
  return [
    mk(
      "policy-front-desk-d1",
      "Front desk — District 1 only",
      "Schedule, make-ups, billing, admissions and the forecast for District 1 only; cannot change class teachers or substitutes.",
      [
        {
          action: "schedule:manage",
          criteria: { centerId: [CENTER_D1] },
          readonlyFields: ["classTeacher", "substitute"],
        },
        { action: "makeup:manage", criteria: { centerId: [CENTER_D1] } },
        { action: "billing:manage", criteria: { centerId: [CENTER_D1] } },
        { action: "admissions:manage", criteria: { centerId: [CENTER_D1] } },
        { action: "students:view", criteria: { centerId: [CENTER_D1] } },
        { action: "forecast:view", criteria: { centerId: [CENTER_D1] } },
        { action: "courses:link", criteria: { centerId: [CENTER_D1] } },
      ],
    ),
    mk(
      "policy-own-classes",
      "Teacher — own classes only",
      "Marks attendance for their own classes only, not as a substitute; sees their own learners' care.",
      [
        { action: "attendance:mark", criteria: { sessionRole: ["owner"] } },
        { action: "students:view" },
      ],
    ),
  ];
}
