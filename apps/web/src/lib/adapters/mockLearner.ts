import type { LearnerPort, LearnerDashboard } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { learnerEnrollments, lessons } from "../../fixtures/learning";

const latency = <T>(v: T, ms = 100): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export const mockLearner: LearnerPort = {
  getDashboard: (personaId) => {
    const p = personaMap[personaId];
    if (!p || !p.learnerId) return latency(null); // fail-closed: no learner scope for this persona
    const dashboard: LearnerDashboard = {
      learnerId: p.learnerId,
      learnerName: "Linh N.",
      orgId: p.orgId,
      enrolled: learnerEnrollments,
      upcoming: lessons.filter((l) => l.scheduledAt !== null),
    };
    return latency(dashboard);
  },
};
