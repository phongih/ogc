// Maps synthetic personas to synthetic domain ids. NON-PRODUCTION demo data only.
import { organizations } from "./directory";

const ORG = organizations[0].id; // Nova Learning Group
const ORG2 = organizations[1].id; // Lumen Education Holdings (used for cross-org negative tests)

export interface PersonaMapping {
  orgId: string;
  learnerId?: string;
  teacherId?: string;
  guardianId?: string;
  linkedLearnerIds?: string[];
  staff?: true; // P2: center staff — manages schedule and teacher assignment in its own tenant
  admin?: true; // Org Admin — staff access + manages access policies (never their own)
}

export const LEARNER_LINH = "00000000-0000-4000-8000-00000000L001";
export const LEARNER_MINH = "00000000-0000-4000-8000-00000000L002";
export const TEACHER_TARA = "00000000-0000-4000-8000-00000000t001";
// P2: a second teacher in the same center — a substitute / reassignment target.
export const TEACHER_BEN = "00000000-0000-4000-8000-00000000t002";
export const GUARDIAN_MAI = "00000000-0000-4000-8000-00000000g001";
// A learner belonging to a DIFFERENT tenant root — for cross-org isolation tests.
export const LEARNER_ORG2 = "00000000-0000-4000-8000-0000000Lo201";

export const personaMap: Record<string, PersonaMapping> = {
  "demo-admin": { orgId: ORG, staff: true, admin: true },
  "demo-staff": { orgId: ORG, staff: true },
  "demo-teacher": { orgId: ORG, teacherId: TEACHER_TARA },
  "demo-teacher-2": { orgId: ORG, teacherId: TEACHER_BEN },
  "demo-learner": { orgId: ORG, learnerId: LEARNER_LINH },
  "demo-learner-2": { orgId: ORG, learnerId: LEARNER_MINH },
  "demo-guardian": { orgId: ORG, guardianId: GUARDIAN_MAI, linkedLearnerIds: [LEARNER_LINH] },
  // A different tenant root — exists only to exercise cross-org isolation in tests.
  "demo-staff-org2": { orgId: ORG2, staff: true },
  "demo-learner-org2": { orgId: ORG2, learnerId: LEARNER_ORG2 },
};

// Synthetic teachers of the demo center (P2 · operations). Names only — no real people.
export const teachers: { id: string; name: string; orgId: string }[] = [
  { id: TEACHER_TARA, name: "Tara", orgId: ORG },
  { id: TEACHER_BEN, name: "Ben", orgId: ORG },
];
export const teacherName = (id: string | undefined): string | null =>
  teachers.find((t) => t.id === id)?.name ?? null;

/*
 * Memberships of each organization, as the organization (EduOS / IIOS, mock) reports them. OGC does
 * not create or remove these — it only lists them and lets an Org Admin attach an access policy.
 * "demo-pending" is in the organization with no OGC role yet: it can use nothing.
 */
export type MemberRole = "admin" | "staff" | "teacher" | "learner" | "guardian" | null;
export const members: {
  personaId: string;
  principalId: string; // the IIOS principal this membership belongs to (synthetic)
  displayName: string;
  role: MemberRole;
  orgId: string;
}[] = [
  {
    personaId: "demo-admin",
    principalId: "iios-principal-admin-1",
    displayName: "Olivia (Org Admin)",
    role: "admin",
    orgId: ORG,
  },
  {
    personaId: "demo-staff",
    principalId: "iios-principal-staff-1",
    displayName: "Sam (Org Staff)",
    role: "staff",
    orgId: ORG,
  },
  {
    personaId: "demo-teacher",
    principalId: "iios-principal-teacher-1",
    displayName: "Tara (Teacher)",
    role: "teacher",
    orgId: ORG,
  },
  {
    personaId: "demo-teacher-2",
    principalId: "iios-principal-teacher-2",
    displayName: "Ben (Teacher)",
    role: "teacher",
    orgId: ORG,
  },
  {
    personaId: "demo-learner",
    principalId: "iios-principal-learner-1",
    displayName: "Linh (Learner)",
    role: "learner",
    orgId: ORG,
  },
  {
    personaId: "demo-learner-2",
    principalId: "iios-principal-learner-2",
    displayName: "Minh (Learner)",
    role: "learner",
    orgId: ORG,
  },
  {
    personaId: "demo-guardian",
    principalId: "iios-principal-guardian-1",
    displayName: "Mai (Guardian)",
    role: "guardian",
    orgId: ORG,
  },
  {
    personaId: "demo-pending",
    principalId: "iios-principal-pending-1",
    displayName: "Quinn (no role yet)",
    role: null,
    orgId: ORG,
  },
  {
    personaId: "demo-staff-org2",
    principalId: "iios-principal-staff-org2",
    displayName: "Staff (Lumen)",
    role: "staff",
    orgId: ORG2,
  },
  {
    personaId: "demo-learner-org2",
    principalId: "iios-principal-learner-org2",
    displayName: "Learner (Lumen)",
    role: "learner",
    orgId: ORG2,
  },
];

/** The IIOS principal behind a demo persona (synthetic). */
export const principalOf = (personaId: string): string | null =>
  members.find((m) => m.personaId === personaId)?.principalId ?? null;
