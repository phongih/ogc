import type { ActivityPrerequisite } from "@ogc/contracts";
import { organizations } from "./directory";

// Deterministic synthetic prerequisite edges (LI-3). NON-PRODUCTION. A clean acyclic graph
// of within-course chains: read → practise → quiz → speak. All intra-tenant (ORG).
const ORG = organizations[0].id;

export const prerequisiteEdges: ActivityPrerequisite[] = [
  { activityId: "ACT-A2-2", orgId: ORG, requiresActivityIds: ["ACT-A2-1"] },
  { activityId: "ACT-A2-3", orgId: ORG, requiresActivityIds: ["ACT-A2-2"] },
  { activityId: "ACT-A2-4", orgId: ORG, requiresActivityIds: ["ACT-A2-3"] },
  { activityId: "ACT-B1-2", orgId: ORG, requiresActivityIds: ["ACT-B1-1"] },
  { activityId: "ACT-B2-2", orgId: ORG, requiresActivityIds: ["ACT-B2-1"] },
];
