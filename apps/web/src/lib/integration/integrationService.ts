import type {
  AppliedRecommendation,
  ClientContext,
  ClientRegistration,
  ExternalSubjectRef,
  IdentityMappingResult,
  IntegrationApplyInput,
  IntegrationAppliedPort,
  IntegrationAppliedResult,
  IntegrationIdentityPort,
  LearnerNextAction,
  LearningActivity,
  MappingProvenance,
  QualityEvidence,
  Skill,
  SkillConfidence,
  SkillEvidence,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { learnerById } from "../../fixtures/learners";
import { placementByLearner } from "../../fixtures/placement";
import { prerequisiteEdges } from "../../fixtures/prerequisites";
import { learningStore } from "../adapters/store";
import { ALL_SKILLS, assessmentTypeForKind, skillForKind } from "../../features/learning/intelligence/skills";
import { seedProfile, updateMastery } from "../../features/learning/intelligence/mastery";
import { computeConfidence } from "../../features/learning/intelligence/confidence";
import { buildLearningPath } from "../../features/learning/intelligence/pathplan";
import { friendlyNextReason } from "../../features/learning/intelligence/friendly";

/*
 * AUTH-027 Phase 0 — SYNTHETIC, in-memory, client-independent integration service boundary.
 *
 * Demonstrates two independent clients (e.g. an EduOS-like client and an independent client)
 * integrating with OGC through ONE shared service instance — NOT two SPA views over a single
 * in-memory SPA store. Enforces tenant + client authorization fail-closed, tenant-scoped
 * identity mapping with no cross-tenant merge, and the AUTH-026 applied-recommendation semantics
 * (one active per learner; system preserved; apply/revert/supersede/invalidation; deterministic
 * audit). NOT persistence, NOT real identity/authz, NOT a production audit system. The authority
 * model (who owns identity/authz) is an OPEN decision — see OGC-DEC-027.
 */

const APPLIED_EPOCH = Date.parse("2026-04-01T00:00:00.000Z");

export function createIntegrationService(registry: readonly ClientRegistration[]) {
  const clients = new Map(registry.map((r) => [r.clientId, r] as const));
  // Tenant-scoped identity map: key `${clientId}::${orgId}::${externalSubjectId}` → learnerId.
  const idMap = new Map<string, ExternalSubjectRef>();
  // Applied state per learnerId (service-owned, synthetic).
  const appliedLog = new Map<string, AppliedRecommendation[]>();
  let appliedSeq = 0;

  // ── Authorization (fail-closed) ─────────────────────────────────────────────
  function clientAuthorized(ctx: ClientContext): boolean {
    const reg = clients.get(ctx.clientId);
    return !!reg && reg.authorizedOrgIds.includes(ctx.orgId);
  }
  // A learner is in scope only when it exists AND belongs to the context's tenant.
  function learnerInTenant(learnerId: string, orgId: string): boolean {
    return learnerById[learnerId]?.orgId === orgId;
  }
  function authorized(ctx: ClientContext, learnerId: string): boolean {
    return clientAuthorized(ctx) && learnerInTenant(learnerId, ctx.orgId);
  }
  // Only a teacher/staff actor may apply or revert an intervention — this PRESERVES the accepted
  // AUTH-026 teacher-only semantics across the integration boundary. It does NOT presuppose the
  // open authority-ownership decision (OGC-DEC-027), which is about WHO grants the client/tenant
  // authorization above, not whether a learner may self-assign a teacher recommendation.
  function canIntervene(ctx: ClientContext): boolean {
    return ctx.role === "teacher" || ctx.role === "staff";
  }

  // ── Learning-intelligence composition (reuses the pure engines) ─────────────
  function scopedActivities(learnerId: string, orgId: string): LearningActivity[] {
    const courseIds = new Set(learnerById[learnerId]?.courseIds ?? []);
    return activities.filter((a) => a.orgId === orgId && courseIds.has(a.courseId));
  }
  function masteryEvidenceFor(learnerId: string, scoped: LearningActivity[]): SkillEvidence[] {
    const out: SkillEvidence[] = [];
    for (const a of scoped) {
      if (!a.assessed) continue;
      const att = learningStore.getAttempt(learnerId, a.id);
      if (!att || att.state !== "completed" || att.score === null || att.completedAt === null) continue;
      out.push({ attemptId: att.id, skill: skillForKind(a.kind), score: att.score, at: att.completedAt });
    }
    return out;
  }
  function qualityEvidenceFor(learnerId: string, scoped: LearningActivity[]): QualityEvidence[] {
    const out: QualityEvidence[] = [];
    for (const a of scoped) {
      if (!a.assessed) continue;
      const att = learningStore.getAttempt(learnerId, a.id);
      if (!att || att.state !== "completed" || att.score === null || att.completedAt === null) continue;
      out.push({ attemptId: att.id, skill: skillForKind(a.kind), assessmentType: assessmentTypeForKind(a.kind), valid: true, at: att.completedAt });
    }
    return out;
  }
  function assessableBySkill(scoped: LearningActivity[]): Record<Skill, number> {
    const c = {} as Record<Skill, number>;
    for (const s of ALL_SKILLS) c[s] = 0;
    for (const a of scoped) if (a.assessed) c[skillForKind(a.kind)] += 1;
    return c;
  }
  function completedIds(learnerId: string, scoped: LearningActivity[]): string[] {
    return scoped.filter((a) => learningStore.getAttempt(learnerId, a.id)?.state === "completed").map((a) => a.id);
  }
  function confidenceFor(learnerId: string, orgId: string): Record<Skill, SkillConfidence> {
    const scoped = scopedActivities(learnerId, orgId);
    return computeConfidence(qualityEvidenceFor(learnerId, scoped), assessableBySkill(scoped));
  }
  function pathFor(learnerId: string, orgId: string) {
    const placement = placementByLearner[learnerId];
    if (!placement || placement.orgId !== orgId) return null;
    const profile = updateMastery(seedProfile(placement), masteryEvidenceFor(learnerId, scopedActivities(learnerId, orgId)));
    const scoped = scopedActivities(learnerId, orgId);
    const edges = prerequisiteEdges.filter((e) => scoped.some((a) => a.id === e.activityId));
    const foreign = new Set(activities.filter((a) => a.orgId !== orgId).map((a) => a.id));
    return buildLearningPath({
      profile,
      confidence: confidenceFor(learnerId, orgId),
      activities: scoped,
      edges,
      completedIds: completedIds(learnerId, scoped),
      foreignActivityIds: foreign,
    });
  }
  const titleOf = (id: string) => activities.find((a) => a.id === id)?.title ?? id;

  // Still-eligible active applied rec, revalidated against the current path (AUTH-026 semantics).
  function activeApplied(learnerId: string, orgId: string): AppliedRecommendation | null {
    const path = pathFor(learnerId, orgId);
    const log = appliedLog.get(learnerId) ?? [];
    for (let i = log.length - 1; i >= 0; i--) {
      const rec = log[i];
      if (rec.status !== "active") continue;
      const step = path?.steps.find((s) => s.activityId === rec.activityId);
      if (step?.state === "available") return rec;
      rec.status = step?.state === "completed" ? "fulfilled" : "invalidated";
      return null;
    }
    return null;
  }

  const identity: IntegrationIdentityPort = {
    mapSubject: async (ctx, externalSubjectId, learnerId, provenance: MappingProvenance) => {
      if (!clientAuthorized(ctx)) return { ok: false, reason: "not_authorized" } as IdentityMappingResult;
      if (!learnerInTenant(learnerId, ctx.orgId)) return { ok: false, reason: "learner_out_of_tenant" };
      // No implicit cross-tenant merge: a mapping is strictly scoped to (clientId, orgId).
      const key = `${ctx.clientId}::${ctx.orgId}::${externalSubjectId}`;
      const existing = idMap.get(key);
      if (existing && existing.learnerId !== learnerId) return { ok: false, reason: "mapping_conflict" };
      const mapping: ExternalSubjectRef = { clientId: ctx.clientId, orgId: ctx.orgId, externalSubjectId, learnerId, provenance };
      idMap.set(key, mapping);
      return { ok: true, mapping: { ...mapping } };
    },
    resolveLearner: async (ctx, externalSubjectId) => {
      if (!clientAuthorized(ctx)) return null;
      return idMap.get(`${ctx.clientId}::${ctx.orgId}::${externalSubjectId}`)?.learnerId ?? null;
    },
  };

  const applied: IntegrationAppliedPort = {
    apply: async (ctx, learnerId, input: IntegrationApplyInput) => {
      if (!authorized(ctx, learnerId) || !canIntervene(ctx)) return { ok: false, reason: "not_authorized" } as IntegrationAppliedResult;
      if (!input.note || input.note.trim().length === 0) return { ok: false, reason: "reason_required" };
      const path = pathFor(learnerId, ctx.orgId);
      if (!path) return { ok: false, reason: "no_path" };
      const step = path.steps.find((s) => s.activityId === input.selectedActivityId);
      if (!step) return { ok: false, reason: "activity_out_of_scope" };
      if (step.state !== "available") return { ok: false, reason: `activity_not_eligible:${step.state}` };

      const log = appliedLog.get(learnerId) ?? [];
      for (const r of log) if (r.status === "active") r.status = "superseded";
      const idx = ++appliedSeq;
      const rec: AppliedRecommendation = {
        id: `IAP-${idx}`,
        learnerId,
        orgId: ctx.orgId,
        activityId: step.activityId,
        courseId: step.courseId,
        skill: step.skill,
        reasonCode: input.reasonCode,
        note: input.note.trim(),
        actorPersonaId: ctx.actorPersonaId,
        teacherId: ctx.actorPersonaId,
        systemActivityIdAtApply: path.nextStep.recommendation?.activityId ?? null,
        appliedAt: new Date(APPLIED_EPOCH + idx * 3600000).toISOString(),
        status: "active",
      };
      log.push(rec);
      appliedLog.set(learnerId, log);
      return { ok: true, applied: { ...rec } };
    },
    revert: async (ctx, learnerId) => {
      if (!authorized(ctx, learnerId) || !canIntervene(ctx)) return { ok: false, reason: "not_authorized" };
      const active = activeApplied(learnerId, ctx.orgId);
      if (!active) return { ok: false, reason: "no_active_recommendation" };
      active.status = "reverted";
      return { ok: true, applied: { ...active } };
    },
    getActive: async (ctx, learnerId) => {
      if (!authorized(ctx, learnerId) || !canIntervene(ctx)) return null;
      const a = activeApplied(learnerId, ctx.orgId);
      return a ? { ...a } : null;
    },
    getNextAction: async (ctx, learnerId) => {
      if (!authorized(ctx, learnerId)) return null;
      const path = pathFor(learnerId, ctx.orgId);
      if (!path) return null;
      const active = activeApplied(learnerId, ctx.orgId);
      if (active) {
        const step = path.steps.find((s) => s.activityId === active.activityId)!;
        return {
          source: "teacher",
          activityId: active.activityId,
          courseId: active.courseId,
          skill: active.skill,
          masteryLevel: step.masteryLevel,
          confidenceBand: step.confidenceBand,
          friendlyReason: friendlyNextReason({ source: "teacher", skill: active.skill, title: titleOf(active.activityId), reasonCode: active.reasonCode, note: active.note }),
          teacherNote: active.note,
        } as LearnerNextAction;
      }
      const rec = path.nextStep.recommendation;
      if (!rec) return null;
      return {
        source: "system",
        activityId: rec.activityId,
        courseId: rec.courseId,
        skill: rec.skill,
        masteryLevel: rec.masteryLevel,
        confidenceBand: path.nextStep.confidenceBand ?? "low",
        friendlyReason: friendlyNextReason({ source: "system", skill: rec.skill, title: titleOf(rec.activityId) }),
        teacherNote: null,
      } as LearnerNextAction;
    },
  };

  return { identity, applied };
}
