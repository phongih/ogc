// Maps synthetic personas to synthetic domain ids. NON-PRODUCTION demo data only.
import { organizations } from "./directory";

const ORG = organizations[0].id; // Nova Learning Group

export const personaMap: Record<string, { orgId: string; learnerId?: string; teacherId?: string }> = {
  "demo-staff": { orgId: ORG },
  "demo-teacher": { orgId: ORG, teacherId: "00000000-0000-4000-8000-00000000t001" },
  "demo-learner": { orgId: ORG, learnerId: "00000000-0000-4000-8000-00000000L001" },
  "demo-guardian": { orgId: ORG },
};
