import type {
  LearnerProfile,
  LearningActivity,
  ActivityPrerequisite,
  LearningPathView,
  LearningPathPort,
  MasteryConfidence,
  MasteryConfidencePort,
  JustifiedRecommendation,
  JustifiedRecommendationPort,
  PathStep,
  PrerequisitePort,
  PlacementPort,
  PlacementResult,
  LearningProfilePort,
  QualityEvidence,
  Recommendation,
  RecommendationPort,
  Skill,
  SkillConfidence,
  SkillEvidence,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { personaMap } from "../../fixtures/personas";
import { learnerById } from "../../fixtures/learners";
import { placementByLearner } from "../../fixtures/placement";
import { prerequisiteEdges } from "../../fixtures/prerequisites";
import { learningStore } from "./store";
import { withFault } from "./faults";
import { ALL_SKILLS, assessmentTypeForKind, skillForKind } from "../../features/learning/intelligence/skills";
import { seedProfile, updateMastery } from "../../features/learning/intelligence/mastery";
import { buildPath, recommend } from "../../features/learning/intelligence/recommend";
import { computeConfidence } from "../../features/learning/intelligence/confidence";
import { justify } from "../../features/learning/intelligence/justify";
import { buildLearningPath } from "../../features/learning/intelligence/pathplan";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

/*
 * LI-1 mock adapters. Self-scoped (persona → its own learnerId) and org-scoped; every
 * entry point fails closed (returns null / empty) when the persona is not a learner, has
 * no placement, or the placement belongs to another tenant. NON-PRODUCTION synthetic:
 * reads the existing in-memory learningStore attempts; no backend, no model, no real data.
 */

// The learnerId a persona may act on, or null (fail-closed for non-learner personas).
function learnerFor(personaId: string): { learnerId: string; orgId: string } | null {
  const p = personaMap[personaId];
  if (!p?.learnerId) return null;
  const learner = learnerById[p.learnerId];
  if (!learner) return null;
  // Org-scope: the persona and its learner must share the tenant root.
  if (learner.orgId !== p.orgId) return null;
  return { learnerId: learner.id, orgId: learner.orgId };
}

// Activities in the learner's scope: same tenant root AND one of the learner's courses.
function scopedActivities(learnerId: string, orgId: string): LearningActivity[] {
  const courseIds = new Set(learnerById[learnerId]?.courseIds ?? []);
  return activities.filter((a) => a.orgId === orgId && courseIds.has(a.courseId));
}

// Assessed, completed, scored attempts → normalized SkillEvidence (idempotency key =
// attempt id). Completing a non-assessed activity yields no score, hence no evidence.
function evidenceFor(learnerId: string, scoped: LearningActivity[]): SkillEvidence[] {
  const out: SkillEvidence[] = [];
  for (const a of scoped) {
    if (!a.assessed) continue;
    const att = learningStore.getAttempt(learnerId, a.id);
    if (!att || att.state !== "completed" || att.score === null || att.completedAt === null) continue;
    out.push({
      attemptId: att.id,
      skill: skillForKind(a.kind),
      score: att.score,
      at: att.completedAt,
    });
  }
  return out;
}

function completedIds(learnerId: string, scoped: LearningActivity[]): string[] {
  return scoped
    .filter((a) => learningStore.getAttempt(learnerId, a.id)?.state === "completed")
    .map((a) => a.id);
}

function placementFor(learnerId: string, orgId: string): PlacementResult | null {
  const p = placementByLearner[learnerId];
  if (!p || p.orgId !== orgId) return null; // fail-closed on missing / cross-org
  return p;
}

function profileFor(learnerId: string, orgId: string): LearnerProfile | null {
  const placement = placementFor(learnerId, orgId);
  if (!placement) return null;
  const scoped = scopedActivities(learnerId, orgId);
  return updateMastery(seedProfile(placement), evidenceFor(learnerId, scoped));
}

export const mockPlacement: PlacementPort = {
  getPlacement: (personaId) =>
    withFault("placement.getPlacement", () => {
      const s = learnerFor(personaId);
      return latency<PlacementResult | null>(s ? placementFor(s.learnerId, s.orgId) : null);
    }),
};

export const mockProfile: LearningProfilePort = {
  getProfile: (personaId) =>
    withFault("profile.getProfile", () => {
      const s = learnerFor(personaId);
      return latency<LearnerProfile | null>(s ? profileFor(s.learnerId, s.orgId) : null);
    }),
};

// ── LI-2: evidence quality + confidence ──────────────────────────────────────

// QualityEvidence for the confidence engine: one per assessed+completed+scored attempt,
// carrying the assessment type. All store-produced evidence is valid by construction.
function qualityEvidenceFor(learnerId: string, scoped: LearningActivity[]): QualityEvidence[] {
  const out: QualityEvidence[] = [];
  for (const a of scoped) {
    if (!a.assessed) continue;
    const att = learningStore.getAttempt(learnerId, a.id);
    if (!att || att.state !== "completed" || att.score === null || att.completedAt === null) continue;
    out.push({
      attemptId: att.id,
      skill: skillForKind(a.kind),
      assessmentType: assessmentTypeForKind(a.kind),
      valid: true,
      at: att.completedAt,
    });
  }
  return out;
}

// The assessable surface per skill in scope: count of assessed activities by skill.
function assessableBySkill(scoped: LearningActivity[]): Record<Skill, number> {
  const counts = {} as Record<Skill, number>;
  for (const s of ALL_SKILLS) counts[s] = 0;
  for (const a of scoped) if (a.assessed) counts[skillForKind(a.kind)] += 1;
  return counts;
}

function confidenceFor(learnerId: string, orgId: string): Record<Skill, SkillConfidence> {
  const scoped = scopedActivities(learnerId, orgId);
  return computeConfidence(qualityEvidenceFor(learnerId, scoped), assessableBySkill(scoped));
}

export const mockMasteryConfidence: MasteryConfidencePort = {
  getConfidence: (personaId) =>
    withFault("confidence.getConfidence", () => {
      const s = learnerFor(personaId);
      if (!s) return latency<MasteryConfidence | null>(null);
      return latency<MasteryConfidence>({
        learnerId: s.learnerId,
        orgId: s.orgId,
        skills: confidenceFor(s.learnerId, s.orgId),
      });
    }),
};

export const mockJustifiedRecommendation: JustifiedRecommendationPort = {
  getJustified: (personaId) =>
    withFault("recommend.getJustified", () => {
      const s = learnerFor(personaId);
      // Fail-closed: a non-learner persona gets a well-formed "nothing to recommend" verdict.
      if (!s) return latency<JustifiedRecommendation>(justify(null, {} as Record<Skill, SkillConfidence>));
      const profile = profileFor(s.learnerId, s.orgId);
      if (!profile) return latency<JustifiedRecommendation>(justify(null, {} as Record<Skill, SkillConfidence>));
      const scoped = scopedActivities(s.learnerId, s.orgId);
      const rec = recommend(profile, scoped, completedIds(s.learnerId, scoped));
      return latency<JustifiedRecommendation>(justify(rec, confidenceFor(s.learnerId, s.orgId)));
    }),
};

// ── LI-3: prerequisite graph + learning path ─────────────────────────────────

// Prerequisite edges whose dependent activity is in the learner's scope.
function scopedEdges(scoped: LearningActivity[]): ActivityPrerequisite[] {
  const ids = new Set(scoped.map((a) => a.id));
  return prerequisiteEdges.filter((e) => ids.has(e.activityId));
}

// Activity ids that exist but belong to ANOTHER tenant — so a prereq pointing at one is
// classified as cross_org (rejected), never followed.
function foreignActivityIds(orgId: string): Set<string> {
  return new Set(activities.filter((a) => a.orgId !== orgId).map((a) => a.id));
}

export const mockPrerequisite: PrerequisitePort = {
  getPrerequisites: (personaId) =>
    withFault("prereq.getPrerequisites", () => {
      const s = learnerFor(personaId);
      return latency<ActivityPrerequisite[]>(s ? scopedEdges(scopedActivities(s.learnerId, s.orgId)) : []);
    }),
};

export const mockLearningPath: LearningPathPort = {
  getLearningPath: (personaId) =>
    withFault("path.getLearningPath", () => {
      const s = learnerFor(personaId);
      if (!s) return latency<LearningPathView | null>(null);
      const profile = profileFor(s.learnerId, s.orgId);
      if (!profile) return latency<LearningPathView | null>(null);
      const scoped = scopedActivities(s.learnerId, s.orgId);
      const plan = buildLearningPath({
        profile,
        confidence: confidenceFor(s.learnerId, s.orgId),
        activities: scoped,
        edges: scopedEdges(scoped),
        completedIds: completedIds(s.learnerId, scoped),
        foreignActivityIds: foreignActivityIds(s.orgId),
      });
      return latency<LearningPathView>({
        learnerId: s.learnerId,
        orgId: s.orgId,
        steps: plan.steps,
        nextStep: plan.nextStep,
        graph: plan.graph,
      });
    }),
};

export const mockRecommendation: RecommendationPort = {
  getRecommendation: (personaId) =>
    withFault("recommend.getRecommendation", () => {
      const s = learnerFor(personaId);
      if (!s) return latency<Recommendation | null>(null);
      const profile = profileFor(s.learnerId, s.orgId);
      if (!profile) return latency<Recommendation | null>(null);
      const scoped = scopedActivities(s.learnerId, s.orgId);
      return latency(recommend(profile, scoped, completedIds(s.learnerId, scoped)));
    }),

  getPath: (personaId) =>
    withFault("recommend.getPath", () => {
      const s = learnerFor(personaId);
      if (!s) return latency<PathStep[]>([]);
      const profile = profileFor(s.learnerId, s.orgId);
      if (!profile) return latency<PathStep[]>([]);
      const scoped = scopedActivities(s.learnerId, s.orgId);
      return latency(buildPath(profile, scoped, completedIds(s.learnerId, scoped)));
    }),
};
