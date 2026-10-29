import type { GuardianPort, GuardianDashboard, GuardianLinkView } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { rosters } from "../../fixtures/teaching";
import { lessons } from "../../fixtures/learning";
import { enrollmentStore, learningStore } from "./store";

const latency = <T>(v: T, ms = 80): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// Flatten synthetic roster rows into a learnerId → displayName lookup.
const displayNames: Record<string, string> = Object.values(rosters)
  .flat()
  .reduce((acc, r) => ((acc[r.learnerId] = r.displayName), acc), {} as Record<string, string>);

// learnerId → backing personaId (only personas carry progress state).
const personaByLearner: Record<string, string> = Object.entries(personaMap).reduce(
  (acc, [pid, m]) => (m.learnerId ? ((acc[m.learnerId] = pid), acc) : acc),
  {} as Record<string, string>,
);

// A linked learner's overall progress = mean of their enrolled-course progress (store-derived).
function overallProgress(learnerId: string): number {
  const pid = personaByLearner[learnerId];
  if (!pid) return 0;
  const courseIds = enrollmentStore.list(pid).map((e) => e.courseId);
  if (courseIds.length === 0) return 0;
  const sum = courseIds.reduce((s, cid) => s + learningStore.courseProgress(pid, cid).progressPct, 0);
  return Math.round(sum / courseIds.length);
}

export const mockGuardian: GuardianPort = {
  // Links are read from the persona's PRE-ESTABLISHED linkedLearnerIds only.
  // D-14: there is no code path by which a guardian adds or self-verifies a link here.
  getDashboard: (personaId) => {
    const p = personaMap[personaId];
    if (!p || !p.guardianId) return latency<GuardianDashboard | null>(null); // fail-closed
    const linkedIds = p.linkedLearnerIds ?? [];

    const links: GuardianLinkView[] = linkedIds.map((learnerId) => {
      const nextLesson = lessons.find((l) => l.scheduledAt !== null);
      return {
        learnerId,
        displayName: displayNames[learnerId] ?? "Linked learner",
        progressPct: overallProgress(learnerId),
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
