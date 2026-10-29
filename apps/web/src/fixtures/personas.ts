// Maps synthetic personas to synthetic domain ids. NON-PRODUCTION demo data only.
import { organizations } from "./directory";

const ORG = organizations[0].id; // Nova Learning Group

export interface PersonaMapping {
  orgId: string;
  learnerId?: string;
  teacherId?: string;
  guardianId?: string;
  linkedLearnerIds?: string[];
}

export const LEARNER_LINH = "00000000-0000-4000-8000-00000000L001";
export const LEARNER_MINH = "00000000-0000-4000-8000-00000000L002";
export const TEACHER_TARA = "00000000-0000-4000-8000-00000000t001";
export const GUARDIAN_MAI = "00000000-0000-4000-8000-00000000g001";

export const personaMap: Record<string, PersonaMapping> = {
  "demo-staff": { orgId: ORG },
  "demo-teacher": { orgId: ORG, teacherId: TEACHER_TARA },
  "demo-learner": { orgId: ORG, learnerId: LEARNER_LINH },
  "demo-learner-2": { orgId: ORG, learnerId: LEARNER_MINH },
  "demo-guardian": { orgId: ORG, guardianId: GUARDIAN_MAI, linkedLearnerIds: [LEARNER_LINH] },
};
