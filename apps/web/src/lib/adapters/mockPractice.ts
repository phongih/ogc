import type {
  PracticeActivityView,
  PracticePort,
  PracticeSubmission,
  PracticeSubmitResult,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { practiceFor } from "../../fixtures/practice";
import { personaMap } from "../../fixtures/personas";
import { learnerById } from "../../fixtures/learners";
import { enrollmentStore, learningStore } from "./store";
import { withFault } from "./faults";
import { prerequisitesBlocking } from "./mockProfile";

/*
 * OGC-AUTH-030 — Practice mock adapter. Self-scoped (persona → its own learnerId), org-scoped,
 * fail-closed. getPractice returns an answer-FREE view; submitPractice delegates to the store's
 * deterministic, idempotent scorer. NON-PRODUCTION synthetic; no backend, no model, no real data.
 */

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// The learnerId a persona may act on, with the activity in its tenant, or null (fail-closed).
export function scopeFor(personaId: string, activityId: string): { learnerId: string } | null {
  const p = personaMap[personaId];
  if (!p?.learnerId) return null;
  const learner = learnerById[p.learnerId];
  if (!learner || learner.orgId !== p.orgId) return null;
  const activity = activities.find((a) => a.id === activityId);
  if (!activity || activity.orgId !== p.orgId) return null; // cross-org never resolves
  if (!learner.courseIds.includes(activity.courseId)) return null; // out of the learner's courses
  return { learnerId: learner.id };
}

// Hard prerequisite gate (owner decision 21/11): true while the learner's path blocks it.
export function lockedFor(learnerId: string, orgId: string, activityId: string): boolean {
  return (prerequisitesBlocking(learnerId, orgId, activityId)?.length ?? 0) > 0;
}

// Same gate for a submission, checked AFTER scope + enrollment so the more basic refusal
// (not_enrolled, cross_org_denied, …) still wins — the store reports those.
export function submissionLocked(personaId: string, activityId: string): boolean {
  const scope = scopeFor(personaId, activityId);
  const activity = activities.find((a) => a.id === activityId);
  if (!scope || !activity || !enrollmentStore.get(personaId, activity.courseId)) return false;
  return lockedFor(scope.learnerId, personaMap[personaId]!.orgId, activityId);
}

export const mockPractice: PracticePort = {
  getPractice: (personaId, activityId) =>
    withFault("practice.getPractice", () => {
      const scope = scopeFor(personaId, activityId);
      if (!scope) return latency<PracticeActivityView | null>(null);
      if (lockedFor(scope.learnerId, personaMap[personaId]!.orgId, activityId))
        return latency<PracticeActivityView | null>(null);
      const practice = practiceFor(activityId);
      if (!practice) return latency<PracticeActivityView | null>(null);
      // Strip correct answers — the learner-facing view never carries them.
      const view: PracticeActivityView = {
        activityId: practice.activityId,
        skill: practice.skill,
        title: practice.title,
        prompt: practice.prompt,
        scoringVersion: practice.scoringVersion,
        items: practice.items.map((i) => ({
          id: i.id,
          prompt: i.prompt,
          options: i.options.map((o) => ({ ...o })),
        })),
      };
      return latency<PracticeActivityView | null>(view);
    }),

  submitPractice: (personaId, activityId, submission: PracticeSubmission) =>
    withFault("practice.submitPractice", () => {
      if (submissionLocked(personaId, activityId))
        return latency<PracticeSubmitResult>({ ok: false, reason: "prerequisite_required" });
      return latency<PracticeSubmitResult>(
        learningStore.submitPractice(personaId, activityId, submission),
      );
    }),
};
