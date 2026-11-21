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
