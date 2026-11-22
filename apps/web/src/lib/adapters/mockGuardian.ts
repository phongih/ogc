import { viaGrant } from "./viewer";
import type { GuardianPort, GuardianDashboard, GuardianLinkView } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { lessons as fixtureLessons, lessonSession } from "../../fixtures/learning";
import { sessionStore } from "./sessionStore";
import { learnerById } from "../../fixtures/learners";
import { learningStore } from "./store";

// P2: lesson times come from the live schedule (reschedule / cancel-with-replacement follow).
const liveLessons = () =>
  fixtureLessons.map((l) => {
    const sid = lessonSession[l.id];
    return sid ? { ...l, scheduledAt: sessionStore.liveAt(sid) } : l;
  });

const latency = <T>(v: T, ms = 80): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// A linked learner's overall progress = mean of their course progress (store-derived,
// keyed by learnerId — the same single source of truth as learner/teacher views).
function overallProgress(learnerId: string): number {
  const courseIds = learnerById[learnerId]?.courseIds ?? [];
  if (courseIds.length === 0) return 0;
  const sum = courseIds.reduce(
    (s, cid) => s + learningStore.courseProgress(learnerId, cid).progressPct,
    0,
  );
  return Math.round(sum / courseIds.length);
}

export const mockGuardian: GuardianPort = viaGrant<GuardianPort>({
  // Links are read from the persona's PRE-ESTABLISHED linkedLearnerIds only.
  // D-14: there is no code path by which a guardian adds or self-verifies a link here.
  getDashboard: (personaId) => {
    const p = personaMap[personaId];
    if (!p || !p.guardianId) return latency<GuardianDashboard | null>(null); // fail-closed
    const linkedIds = p.linkedLearnerIds ?? [];
    const lessons = liveLessons();

    const links: GuardianLinkView[] = linkedIds.map((learnerId) => {
      const nextLesson = lessons.find((l) => l.scheduledAt !== null);
      return {
        learnerId,
        displayName: learnerById[learnerId]?.displayName ?? "Linked learner",
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
});
