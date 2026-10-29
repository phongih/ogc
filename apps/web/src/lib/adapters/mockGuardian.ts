import type { GuardianPort, GuardianDashboard, GuardianLinkView } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { rosters } from "../../fixtures/teaching";
import { lessons } from "../../fixtures/learning";
import { learnerEnrollments } from "../../fixtures/learning";

const latency = <T>(v: T, ms = 80): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// Flatten synthetic roster rows into a learnerId → displayName lookup.
const displayNames: Record<string, string> = Object.values(rosters)
  .flat()
  .reduce((acc, r) => ((acc[r.learnerId] = r.displayName), acc), {} as Record<string, string>);

export const mockGuardian: GuardianPort = {
  // Links are read from the persona's PRE-ESTABLISHED linkedLearnerIds only.
  // D-14: there is no code path by which a guardian adds or self-verifies a link here.
  getDashboard: (personaId) => {
    const p = personaMap[personaId];
    if (!p || !p.guardianId) return latency<GuardianDashboard | null>(null); // fail-closed
    const linkedIds = p.linkedLearnerIds ?? [];

    const links: GuardianLinkView[] = linkedIds.map((learnerId) => {
      const enr = learnerEnrollments[0]; // synthetic: linked learner's primary course
      const nextLesson = lessons.find((l) => l.scheduledAt !== null);
      return {
        learnerId,
        displayName: displayNames[learnerId] ?? "Linked learner",
        progressPct: enr?.progressPct ?? 0,
        consentStatus: "active",
        nextSessionAt: nextLesson?.scheduledAt ?? null,
      };
    });

    const dashboard: GuardianDashboard = {
      guardianId: p.guardianId,
      guardianName: "Mai (guardian)",
      orgId: p.orgId,
      links,
    };
    return latency<GuardianDashboard | null>(dashboard);
  },
};
