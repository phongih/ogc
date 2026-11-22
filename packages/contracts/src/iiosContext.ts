import { z } from "zod";
import { Id } from "./common.js";
import { ActorRole } from "./integration.js";
import {
  PolicyRule,
  type AccessAdminView,
  type PolicyInput,
  type PolicyResult,
} from "./accessPolicy.js";

/*
 * OGC-AUTH-027 / Phase 1 DESIGN — IIOS-Granted Context (DESIGN-ONLY, SYNTHETIC, MOCK).
 *
 * Per OGC-DEC-027 (Option C) and OGC-IIOS-001 §3: authorization is established UPSTREAM by IIOS via
 * a sealed, server-side principal binding (HMAC over org|principal|purpose|active_center|request_id
 * |pid|xact_id|exp). OGC is a pure CONSUMER of the IIOS decision:
 *   - OGC never holds the signing key, never computes/verifies the HMAC, never issues or signs a
 *     principal, and never writes an authz relation.
 *   - OGC receives a RESOLUTION whose `state` was decided by IIOS, and honours it fail-closed.
 *
 * This contract models the SHAPE of that received context and the boundary states. It is NOT a
 * verification mechanism and proves nothing about production IIOS security.
 */

// The decision states OGC may receive back from the trusted IIOS boundary. OGC does not compute
// these — it is told which one applies. Anything other than "valid" denies.
export const IiosContextState = z.enum(["valid", "missing", "expired", "cross_tenant", "revoked"]);
export type IiosContextState = z.infer<typeof IiosContextState>;

// The sealed context AS RECEIVED after IIOS has decided it is valid. Deliberately carries NO key,
// NO mac/hmac, and NO verification material — OGC is downstream of the trust boundary.
export const IiosGrantedContext = z
  .object({
    clientId: z.string().min(1),
    orgId: Id, // tenant the grant is scoped to
    principalId: z.string().min(1), // the IIOS-established principal (natural-person-mapped upstream)
    role: ActorRole,
    purpose: z.string().min(1), // consent/purpose the grant was issued for
    activeCenter: z.string().optional(), // narrowing only (AZ7)
    // OGC-ADR-039 §5 (PROPOSED grant change for OGC-IIOS-001 — IIOS decides, OGC only consumes):
    orgAdmin: z.boolean().optional(), // IIOS says this principal administers the org's access policies
    narrowing: z.lazy(() => GrantNarrowing).optional(), // absent = no narrowing (backward compatible)
    requestId: z.string().min(1), // for audit correlation with IIOS (OGC-IIOS-001 §8)
    grantRef: z.string().min(1), // opaque IIOS reference; OGC treats it as a token, never decodes it
    expiresAt: z.string().min(1), // informational; expiry is DECIDED by IIOS, not re-computed by OGC
  })
  .strict();
export type IiosGrantedContext = z.infer<typeof IiosGrantedContext>;

export const IiosContextResolution = z.object({
  state: IiosContextState,
  context: IiosGrantedContext.optional(), // present ONLY when state === "valid"
});
export type IiosContextResolution = z.infer<typeof IiosContextResolution>;

/*
 * The port OGC uses to obtain a decided context from the trusted IIOS boundary. OGC passes the
 * opaque presented grant plus the tenant it intends to act in; the BOUNDARY (IIOS, mocked here)
 * returns the decided state. OGC never verifies a signature itself.
 */
export interface IiosContextPort {
  resolveContext(presentedGrant: string, intendedOrgId: string): Promise<IiosContextResolution>;
}

// Error raised when a domain operation is attempted without a valid IIOS-granted context.
export class IiosContextDenied extends Error {
  constructor(public readonly state: IiosContextState) {
    super(`iios_context_denied:${state}`);
    this.name = "IiosContextDenied";
  }
}

/*
 * Fail-closed guard: returns the granted context ONLY when IIOS decided "valid"; otherwise throws.
 * This is the single choke-point every domain operation must pass. It makes NO authorization
 * decision of its own — it only honours the state IIOS returned (deny-by-default on anything else).
 */
export function requireValidContext(resolution: IiosContextResolution): IiosGrantedContext {
  if (resolution.state !== "valid" || !resolution.context) {
    throw new IiosContextDenied(resolution.state);
  }
  return resolution.context;
}

/*
 * OGC-ADR-039 §5 — narrowing DECIDED BY IIOS and carried with the grant (Option C: IIOS stores and
 * decides; OGC enforces and never writes an authz relation). The policy itself lives in IIOS.
 *   - "none":        the role's normal access;
 *   - "policy":      only what one of `rules` allows (role ∩ policy — never more than the role);
 *   - "unavailable": IIOS could not resolve the policy (missing / retired) → nothing is allowed.
 */
export const GrantNarrowing = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  z.object({
    state: z.literal("policy"),
    policyRef: z.string().min(1), // opaque IIOS reference
    version: z.number().int().min(1),
    name: z.string(), // display only
    rules: z.array(PolicyRule).min(1),
  }),
  z.object({ state: z.literal("unavailable") }),
]);
export type GrantNarrowing = z.infer<typeof GrantNarrowing>;

/*
 * OGC-ADR-039 §5 — Option C: IIOS STORES and DECIDES access policies; the OGC Access page is only
 * the editing UI and calls this port. OGC keeps no copy. Every call carries the caller's granted
 * context; IIOS refuses unless `ctx.orgAdmin` is true for `ctx.orgId`, and never lets a principal
 * change their own membership or a policy that narrows them (anti self-escalation).
 * Members are identified by their IIOS principal id. Mocked in `lib/integration/` (synthetic).
 */
export interface IiosPolicyAdminPort {
  getAdminView(ctx: IiosGrantedContext): Promise<AccessAdminView | null>;
  createPolicy(ctx: IiosGrantedContext, input: PolicyInput): Promise<PolicyResult>;
  revisePolicy(
    ctx: IiosGrantedContext,
    policyRef: string,
    expectedVersion: number,
    patch: { description?: string | null; rules?: PolicyRule[] },
  ): Promise<PolicyResult>;
  retirePolicy(
    ctx: IiosGrantedContext,
    policyRef: string,
    expectedVersion: number,
  ): Promise<PolicyResult>;
  attachPolicy(
    ctx: IiosGrantedContext,
    memberPrincipalId: string,
    policyRef: string | null,
  ): Promise<PolicyResult>;
}

/*
 * OGC-ADR-039 step 3b — every operations port (schedule, make-up, center setup, Decision Engine,
 * attendance, my-access) takes the CALLER'S IIOS-GRANTED CONTEXT as its first argument, never a
 * persona id from the frontend. Tenant, role and narrowing come from it; OGC-only relations (which
 * OGC teacher / learner record a principal is) are looked up from the principal, as OGC data.
 */
