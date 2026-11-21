import { organizations } from "./directory";
import { courses } from "./catalog";
import { LEARNER_LINH, LEARNER_MINH, LEARNER_ORG2 } from "./personas";

const ORG = organizations[0].id;
const ORG2 = organizations[1].id;

// Roster learner ids that have NO login persona (appear only on class rosters).
export const LEARNER_AN = "00000000-0000-4000-8000-00000000L003";
export const LEARNER_HUY = "00000000-0000-4000-8000-00000000L004";
export const LEARNER_THAO = "00000000-0000-4000-8000-00000000L005";

export interface SyntheticLearner {
  id: string; // learnerId — the domain subject, distinct from any personaId
  orgId: string; // tenant root the learner belongs to (org-scoped identity)
  displayName: string;
  courseIds: string[]; // synthetic course association for progress coverage
}

const A2 = courses[0].id;
const B1 = courses[1].id;

// Learner directory. EVERY roster learner is here, including those with no persona,
// so progress can be computed for all of them (S5-B coverage requirement).
export const learnerDirectory: SyntheticLearner[] = [
  { id: LEARNER_LINH, orgId: ORG, displayName: "Linh N.", courseIds: [A2, B1] },
  { id: LEARNER_MINH, orgId: ORG, displayName: "Minh T.", courseIds: [A2] },
  { id: LEARNER_AN, orgId: ORG, displayName: "An P.", courseIds: [A2] },
  { id: LEARNER_HUY, orgId: ORG, displayName: "Huy D.", courseIds: [B1] },
  { id: LEARNER_THAO, orgId: ORG, displayName: "Thao V.", courseIds: [B1] },
  // Different tenant root — isolation test subject (no shared courses).
  { id: LEARNER_ORG2, orgId: ORG2, displayName: "Org2 Learner", courseIds: [] },
];

export const learnerById: Record<string, SyntheticLearner> = learnerDirectory.reduce(
  (acc, l) => ((acc[l.id] = l), acc),
  {} as Record<string, SyntheticLearner>,
);

// Deterministic seed of completed activities per learner. Chosen to exercise every
// course-level state: not_started (Huy), in_progress (Linh/Minh/An) and completed (Thao).
export const LEARNER_SEED: Record<string, string[]> = {
  [LEARNER_LINH]: ["ACT-A2-1", "ACT-A2-2", "ACT-B1-1"],
  [LEARNER_MINH]: ["ACT-A2-1"],
  [LEARNER_AN]: ["ACT-A2-1", "ACT-A2-2", "ACT-A2-3"],
  [LEARNER_HUY]: [],
  [LEARNER_THAO]: ["ACT-B1-1", "ACT-B1-2"],
};
