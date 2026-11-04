import { z } from "zod";
import { Id } from "./common.js";
import { InterventionReasonCode } from "./intervention.js";
import { AppliedRecommendation, LearnerNextAction } from "./applied.js";

/*
 * API-FIRST INTEGRATION — Phase 0 contracts (OGC-AUTH-027). ADDITIVE, SYNTHETIC, DESIGN-STAGE.
 *
 * These contracts model a CLIENT-INDEPENDENT service boundary so an institutional client (e.g.
 * EduOS) and an independent client can both integrate with OGC without either becoming OGC's
 * identity/authorization/data-ownership authority by default. They are a surface definition,
 * NOT an enforcement or ownership decision — the authority model is an OPEN governance decision
 * (see OGC-DEC-027). No real backend/identity/IIOS. The in-memory synthetic service that
 * implements these is NOT persistence and NOT a production audit system.
 */

// An integration client application (EduOS or an independent client).
export const ClientId = z.string().min(1);
export type ClientId = z.infer<typeof ClientId>;

export const ActorRole = z.enum(["staff", "teacher", "guardian", "learner", "service"]);
export type ActorRole = z.infer<typeof ActorRole>;

// Synthetic client registration — which tenants a client is authorized for. The authority that
// grants this is the OPEN decision (OGC-owned registry vs IIOS-granted); modeled here as data.
export const ClientRegistration = z.object({
  clientId: ClientId,
  name: z.string().min(1),
  authorizedOrgIds: z.array(Id), // tenants this client may act within (fail-closed otherwise)
});
export type ClientRegistration = z.infer<typeof ClientRegistration>;

// The explicit, tenant-scoped authorization context carried on EVERY integration request. The
// tenant (orgId) is explicit and never inferred from the caller's free input downstream.
export const ClientContext = z.object({
  clientId: ClientId,
  orgId: Id, // tenant root this request acts within
  actorPersonaId: z.string().min(1), // the acting principal (synthetic persona id in Phase 0)
  role: ActorRole,
});
export type ClientContext = z.infer<typeof ClientContext>;

// Learner identity mapping — maps an EXTERNAL client subject to an OGC learner, tenant-scoped.
// provenance records who asserted the mapping; no implicit identity merging across tenants.
export const MappingProvenance = z.enum(["client_asserted", "ogc_verified"]);
export type MappingProvenance = z.infer<typeof MappingProvenance>;

export const ExternalSubjectRef = z.object({
  clientId: ClientId,
  orgId: Id,
  externalSubjectId: z.string().min(1), // the client's own subject identifier
  learnerId: Id, // the OGC learner it maps to (tenant-scoped unique)
  provenance: MappingProvenance,
});
export type ExternalSubjectRef = z.infer<typeof ExternalSubjectRef>;

export const IdentityMappingResult = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  mapping: ExternalSubjectRef.optional(),
});
export type IdentityMappingResult = z.infer<typeof IdentityMappingResult>;

export interface IntegrationApplyInput {
  selectedActivityId: string;
  reasonCode: InterventionReasonCode;
  note: string;
}

// Client-independent identity port. Fail-closed on unauthorized client/tenant.
export interface IntegrationIdentityPort {
  mapSubject(ctx: ClientContext, externalSubjectId: string, learnerId: string, provenance: MappingProvenance): Promise<IdentityMappingResult>;
  resolveLearner(ctx: ClientContext, externalSubjectId: string): Promise<string | null>;
}

// Client-independent applied-recommendation port — preserves AUTH-026 semantics (one active per
// learner; system preserved; apply/revert/supersede/invalidation; fail-closed; deterministic
// audit) across a shared service boundary. Reuses the AUTH-026 result/view types.
export interface IntegrationAppliedResult {
  ok: boolean;
  reason?: string;
  applied?: AppliedRecommendation;
}
export interface IntegrationAppliedPort {
  apply(ctx: ClientContext, learnerId: string, input: IntegrationApplyInput): Promise<IntegrationAppliedResult>;
  revert(ctx: ClientContext, learnerId: string): Promise<IntegrationAppliedResult>;
  getActive(ctx: ClientContext, learnerId: string): Promise<AppliedRecommendation | null>;
  getNextAction(ctx: ClientContext, learnerId: string): Promise<LearnerNextAction | null>;
}
