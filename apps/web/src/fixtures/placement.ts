import type { PlacementResult } from "@ogc/contracts";
import { organizations } from "./directory";
import {
  LEARNER_LINH,
  LEARNER_MINH,
  LEARNER_ORG2,
} from "./personas";
import { LEARNER_AN, LEARNER_HUY, LEARNER_THAO } from "./learners";

// Deterministic synthetic placement results (LI-1). NON-PRODUCTION — these stand in for
// a real adaptive placement test. Each covers every skill in the taxonomy. Seeds are
// chosen so the weakest skill differs across learners (varied recommendations).
const ORG = organizations[0].id;
const ORG2 = organizations[1].id;

export const placementByLearner: Record<string, PlacementResult> = {
  // Linh — speaking is the weakest seed (matches OGC-VISION-020 §3).
  [LEARNER_LINH]: {
    learnerId: LEARNER_LINH,
    orgId: ORG,
    cefrBand: "A2",
    skillSeed: { reading: 70, use_of_english: 65, speaking: 55 },
  },
  // Minh — use_of_english weakest.
  [LEARNER_MINH]: {
    learnerId: LEARNER_MINH,
    orgId: ORG,
    cefrBand: "A2",
    skillSeed: { reading: 68, use_of_english: 52, speaking: 60 },
  },
  [LEARNER_AN]: {
    learnerId: LEARNER_AN,
    orgId: ORG,
    cefrBand: "A2",
    skillSeed: { reading: 58, use_of_english: 64, speaking: 62 },
  },
  [LEARNER_HUY]: {
    learnerId: LEARNER_HUY,
    orgId: ORG,
    cefrBand: "B1",
    skillSeed: { reading: 72, use_of_english: 70, speaking: 66 },
  },
  [LEARNER_THAO]: {
    learnerId: LEARNER_THAO,
    orgId: ORG,
    cefrBand: "B1",
    skillSeed: { reading: 75, use_of_english: 74, speaking: 71 },
  },
  // Different tenant root — isolation subject.
  [LEARNER_ORG2]: {
    learnerId: LEARNER_ORG2,
    orgId: ORG2,
    cefrBand: "A2",
    skillSeed: { reading: 60, use_of_english: 60, speaking: 60 },
  },
};
