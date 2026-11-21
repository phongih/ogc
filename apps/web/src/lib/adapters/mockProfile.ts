import type {
  LearnerProfile,
  LearningActivity,
  ActivityPrerequisite,
  AppliedRecommendation,
  AppliedRecommendationPort,
  ApplyResult,
  InterventionResult,
  LearnerNextAction,
  LearnerNextActionPort,
  LearningPathView,
  LearningPathPort,
  MasteryConfidence,
  MasteryConfidencePort,
  JustifiedRecommendation,
  JustifiedRecommendationPort,
  PathStep,
  PrerequisitePort,
  TeacherIntervention,
  TeacherLearningIntelligencePort,
  TeacherLearningView,
  PlacementPort,
  PlacementResult,
  LearningProfilePort,
  QualityEvidence,
  Recommendation,
  RecommendationPort,
  Skill,
  SkillConfidence,
  SkillEvidence,
  SupportItem,
  SupportPort,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { personaMap } from "../../fixtures/personas";
import { learnerById } from "../../fixtures/learners";
import { placementByLearner } from "../../fixtures/placement";
import { prerequisiteEdges } from "../../fixtures/prerequisites";
import { classes, classTeachers, rosters } from "../../fixtures/teaching";
import { learningStore } from "./store";
import { withFault } from "./faults";
import { ALL_SKILLS, assessmentTypeForKind, skillForKind } from "../../features/learning/intelligence/skills";
import { seedProfile, updateMastery } from "../../features/learning/intelligence/mastery";
import { buildPath, recommend } from "../../features/learning/intelligence/recommend";
import { computeConfidence } from "../../features/learning/intelligence/confidence";
import { justify } from "../../features/learning/intelligence/justify";
import { buildLearningPath } from "../../features/learning/intelligence/pathplan";
import { friendlyNextReason } from "../../features/learning/intelligence/friendly";
import { focusSkill, supportSignals } from "../../features/learning/intelligence/support";

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

// ── LI-4: teacher intervention & explainability ──────────────────────────────

// Build the full learning-path view for a learner id (reused by the teacher view).
function learnerPathView(learnerId: string, orgId: string): LearningPathView | null {
  const profile = profileFor(learnerId, orgId);
  if (!profile) return null;
  const scoped = scopedActivities(learnerId, orgId);
  const plan = buildLearningPath({
    profile,
    confidence: confidenceFor(learnerId, orgId),
    activities: scoped,
    edges: scopedEdges(scoped),
    completedIds: completedIds(learnerId, scoped),
    foreignActivityIds: foreignActivityIds(orgId),
  });
  return { learnerId, orgId, steps: plan.steps, nextStep: plan.nextStep, graph: plan.graph };
}

// Hard prerequisite gate (owner decision 21/11): the activity ids that still block `activityId`
// for this learner, [] when it is open, or null when it is not in the learner's path at all.
// Single source of truth = the same LI-3 path the learner and the teacher already see.
export function prerequisitesBlocking(learnerId: string, orgId: string, activityId: string): string[] | null {
  const path = learnerPathView(learnerId, orgId);
  const step = path?.steps.find((s) => s.activityId === activityId);
  if (!step) return null;
  return step.state === "blocked" ? [...(step.blockedBy ?? [])] : [];
}

// Fail-closed teacher→learner authorization: the viewer must be a teacher who OWNS a class
// whose roster contains the learner, AND share the learner's tenant. Returns null otherwise
// (guardians, learners, staff and cross-org/unrelated teachers are all denied).
export function teacherOwnsLearner(viewerPersonaId: string, learnerId: string): { teacherId: string; orgId: string } | null {
  const viewer = personaMap[viewerPersonaId];
  const teacherId = viewer?.teacherId;
  if (!teacherId) return null;
  const owned = Object.entries(classTeachers)
    .filter(([, t]) => t === teacherId)
    .map(([classId]) => classId);
  const onRoster = owned.some((classId) => (rosters[classId] ?? []).some((r) => r.learnerId === learnerId));
  if (!onRoster) return null;
  const learner = learnerById[learnerId];
  if (!learner || learner.orgId !== viewer.orgId) return null; // cross-org guard
  return { teacherId, orgId: viewer.orgId };
}

// Synthetic in-memory audit store for interventions (keyed by learnerId). Deterministic ts.
const INTERVENTION_EPOCH = Date.parse("2026-02-01T00:00:00.000Z");
let interventionSeq = 0;
const interventions = new Map<string, TeacherIntervention[]>();

export const mockTeacherIntelligence: TeacherLearningIntelligencePort = {
  getLearnerView: (viewerPersonaId, learnerId) =>
    withFault("teacher.getLearnerView", () => {
      const auth = teacherOwnsLearner(viewerPersonaId, learnerId);
      if (!auth) return latency<TeacherLearningView | null>(null);
      const profile = profileFor(learnerId, auth.orgId);
      const path = learnerPathView(learnerId, auth.orgId);
      if (!profile || !path) return latency<TeacherLearningView | null>(null);
      const confidence: MasteryConfidence = {
        learnerId,
        orgId: auth.orgId,
        skills: confidenceFor(learnerId, auth.orgId),
      };
      return latency<TeacherLearningView>({ learnerId, orgId: auth.orgId, profile, confidence, path });
    }),

  intervene: (viewerPersonaId, learnerId, input) =>
    withFault("teacher.intervene", () => {
      const auth = teacherOwnsLearner(viewerPersonaId, learnerId);
      if (!auth) return latency<InterventionResult>({ ok: false, reason: "not_authorized" });
      if (!input.note || input.note.trim().length === 0)
        return latency<InterventionResult>({ ok: false, reason: "reason_required" });
      const path = learnerPathView(learnerId, auth.orgId);
      if (!path) return latency<InterventionResult>({ ok: false, reason: "no_path" });
      const step = path.steps.find((s) => s.activityId === input.selectedActivityId);
      if (!step) return latency<InterventionResult>({ ok: false, reason: "activity_out_of_scope" });
      // Prerequisites are never bypassed: only an AVAILABLE activity may be selected.
      if (step.state !== "available")
        return latency<InterventionResult>({ ok: false, reason: `activity_not_eligible:${step.state}` });

      const idx = ++interventionSeq;
      const rec: TeacherIntervention = {
        id: `INT-${idx}`,
        actorPersonaId: viewerPersonaId,
        teacherId: auth.teacherId,
        learnerId,
        orgId: auth.orgId,
        // The system recommendation is PRESERVED (recorded, not overwritten).
        systemActivityId: path.nextStep.recommendation?.activityId ?? null,
        selectedActivityId: input.selectedActivityId,
        reasonCode: input.reasonCode,
        note: input.note.trim(),
        at: new Date(INTERVENTION_EPOCH + idx * 3600000).toISOString(),
      };
      const list = interventions.get(learnerId) ?? [];
      list.push(rec);
      interventions.set(learnerId, list);
      return latency<InterventionResult>({ ok: true, intervention: { ...rec } });
    }),

  listInterventions: (viewerPersonaId, learnerId) =>
    withFault("teacher.listInterventions", () => {
      const auth = teacherOwnsLearner(viewerPersonaId, learnerId);
      if (!auth) return latency<TeacherIntervention[]>([]);
      return latency<TeacherIntervention[]>((interventions.get(learnerId) ?? []).map((x) => ({ ...x })));
    }),
};

// ── AUTH-026: applied teacher recommendation (reaches the learner) ───────────

const APPLIED_EPOCH = Date.parse("2026-03-01T00:00:00.000Z");
let appliedSeq = 0;
const appliedLog = new Map<string, AppliedRecommendation[]>(); // keyed by learnerId

const activityTitle = (id: string): string => activities.find((a) => a.id === id)?.title ?? id;

// The still-eligible active applied recommendation, revalidated against the CURRENT path.
// Deterministically transitions a stale one to fulfilled/invalidated (persisted) and returns
// null when nothing is actively reaching the learner.
function activeAppliedFor(learnerId: string, path: LearningPathView): AppliedRecommendation | null {
  const log = appliedLog.get(learnerId) ?? [];
  for (let i = log.length - 1; i >= 0; i--) {
    const rec = log[i];
    if (rec.status !== "active") continue;
    const step = path.steps.find((s) => s.activityId === rec.activityId);
    if (step?.state === "available") return rec; // still eligible
    rec.status = step?.state === "completed" ? "fulfilled" : "invalidated"; // revalidate
    return null;
  }
  return null;
}

export const mockAppliedRecommendation: AppliedRecommendationPort = {
  applyRecommendation: (viewerPersonaId, learnerId, input) =>
    withFault("applied.apply", () => {
      const auth = teacherOwnsLearner(viewerPersonaId, learnerId);
      if (!auth) return latency<ApplyResult>({ ok: false, reason: "not_authorized" });
      if (!input.note || input.note.trim().length === 0)
        return latency<ApplyResult>({ ok: false, reason: "reason_required" });
      const path = learnerPathView(learnerId, auth.orgId);
      if (!path) return latency<ApplyResult>({ ok: false, reason: "no_path" });
      const step = path.steps.find((s) => s.activityId === input.selectedActivityId);
      if (!step) return latency<ApplyResult>({ ok: false, reason: "activity_out_of_scope" });
      if (step.state !== "available")
        return latency<ApplyResult>({ ok: false, reason: `activity_not_eligible:${step.state}` });

      const log = appliedLog.get(learnerId) ?? [];
      // One active per learner: supersede any currently-active record.
      for (const r of log) if (r.status === "active") r.status = "superseded";

      const idx = ++appliedSeq;
      const rec: AppliedRecommendation = {
        id: `APP-${idx}`,
        learnerId,
        orgId: auth.orgId,
        activityId: step.activityId,
        courseId: step.courseId,
        skill: step.skill,
        reasonCode: input.reasonCode,
        note: input.note.trim(),
        actorPersonaId: viewerPersonaId,
        teacherId: auth.teacherId,
        // The system recommendation is PRESERVED (recorded, never overwritten).
        systemActivityIdAtApply: path.nextStep.recommendation?.activityId ?? null,
        appliedAt: new Date(APPLIED_EPOCH + idx * 3600000).toISOString(),
        status: "active",
      };
      log.push(rec);
      appliedLog.set(learnerId, log);
      return latency<ApplyResult>({ ok: true, applied: { ...rec } });
    }),

  revertApplied: (viewerPersonaId, learnerId) =>
    withFault("applied.revert", () => {
      const auth = teacherOwnsLearner(viewerPersonaId, learnerId);
      if (!auth) return latency<ApplyResult>({ ok: false, reason: "not_authorized" });
      const path = learnerPathView(learnerId, auth.orgId);
      const active = path ? activeAppliedFor(learnerId, path) : null;
      if (!active) return latency<ApplyResult>({ ok: false, reason: "no_active_recommendation" });
      active.status = "reverted";
      return latency<ApplyResult>({ ok: true, applied: { ...active } });
    }),

  getActiveApplied: (viewerPersonaId, learnerId) =>
    withFault("applied.getActive", () => {
      const auth = teacherOwnsLearner(viewerPersonaId, learnerId);
      if (!auth) return latency<AppliedRecommendation | null>(null);
      const path = learnerPathView(learnerId, auth.orgId);
      const active = path ? activeAppliedFor(learnerId, path) : null;
      return latency<AppliedRecommendation | null>(active ? { ...active } : null);
    }),
};

export const mockLearnerNextAction: LearnerNextActionPort = {
  getNextAction: (personaId) =>
    withFault("applied.getNextAction", () => {
      const s = learnerFor(personaId);
      if (!s) return latency<LearnerNextAction | null>(null);
      const path = learnerPathView(s.learnerId, s.orgId);
      if (!path) return latency<LearnerNextAction | null>(null);

      // Teacher-applied takes precedence while active + eligible.
      const active = activeAppliedFor(s.learnerId, path);
      if (active) {
        const step = path.steps.find((st) => st.activityId === active.activityId)!;
        return latency<LearnerNextAction>({
          source: "teacher",
          activityId: active.activityId,
          courseId: active.courseId,
          skill: active.skill,
          masteryLevel: step.masteryLevel,
          confidenceBand: step.confidenceBand,
          friendlyReason: friendlyNextReason({
            source: "teacher",
            skill: active.skill,
            title: activityTitle(active.activityId),
            reasonCode: active.reasonCode,
            note: active.note,
          }),
          teacherNote: active.note,
        });
      }

      // Otherwise the system recommendation (LI-3 path nextStep).
      const rec = path.nextStep.recommendation;
      if (!rec) return latency<LearnerNextAction | null>(null);
      return latency<LearnerNextAction>({
        source: "system",
        activityId: rec.activityId,
        courseId: rec.courseId,
        skill: rec.skill,
        masteryLevel: rec.masteryLevel,
        confidenceBand: path.nextStep.confidenceBand ?? "low",
        friendlyReason: friendlyNextReason({
          source: "system",
          skill: rec.skill,
          title: activityTitle(rec.activityId),
        }),
        teacherNote: null,
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

// ── P1 · Learners needing support (owning teacher) ───────────────────────────────────────────
// Evidence first (owner decision 21/11): every flag states its source. Reuses the LI-1 fold, the
// LI-3 path (only an AVAILABLE activity is suggested) and AUTH-026 (current assignment).
export const mockSupport: SupportPort = {
  listNeedsSupport: (viewerPersonaId) =>
    withFault("support.listNeedsSupport", () => {
      const teacherId = personaMap[viewerPersonaId]?.teacherId;
      if (!teacherId) return latency<SupportItem[]>([]);
      const items: SupportItem[] = [];
      const seen = new Set<string>();
      for (const [classId, owner] of Object.entries(classTeachers)) {
        if (owner !== teacherId) continue;
        const className = classes.find((c) => c.id === classId)?.name ?? "Class";
        for (const row of rosters[classId] ?? []) {
          if (seen.has(row.learnerId)) continue;
          seen.add(row.learnerId);
          const auth = teacherOwnsLearner(viewerPersonaId, row.learnerId);
          if (!auth) continue; // same-tenant guard
          const placement = placementFor(row.learnerId, auth.orgId);
          const path = learnerPathView(row.learnerId, auth.orgId);
          if (!placement || !path) continue;
          const scoped = scopedActivities(row.learnerId, auth.orgId);
          const returned = learningStore.listSpeaking([row.learnerId], "returned").length;
          const signals = supportSignals(seedProfile(placement), evidenceFor(row.learnerId, scoped), returned);
          if (signals.length === 0) continue;
          const focus = focusSkill(signals);
          const suggestion =
            path.steps.find((st) => st.state === "available" && st.skill === focus) ?? null;
          const active = activeAppliedFor(row.learnerId, path);
          items.push({
            learnerId: row.learnerId,
            learnerName: row.displayName,
            className,
            signals,
            evidenceBacked: signals.some((x) => x.source !== "placement"),
            focusSkill: focus,
            suggestedActivityId: suggestion?.activityId ?? null,
            suggestedTitle: suggestion ? activityTitle(suggestion.activityId) : null,
            activeAssignmentTitle: active ? activityTitle(active.activityId) : null,
          });
        }
      }
      // Evidence-backed first; then the lowest flagged level.
      const minLevel = (i: SupportItem) => Math.min(...i.signals.map((x) => x.level ?? 100));
      items.sort((a, b) => Number(b.evidenceBacked) - Number(a.evidenceBacked) || minLevel(a) - minLevel(b));
      return latency(items);
    }),
};
