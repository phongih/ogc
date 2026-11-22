import {
  POLICY_CATALOG,
  type PolicyAction,
  type PolicyRule,
  type ReadonlyField,
  type SessionRole,
} from "./accessPolicy.js";
import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * OGC-ADR-039 §5 — the single authorization decision point (CONTRACT + reference evaluator).
 *
 * OGC evaluates ONLY what IIOS already decided and handed over in the granted context:
 *   tenant (ctx.orgId) · role (ctx.role) · active center (ctx.activeCenter) · narrowing (ctx.narrowing).
 * It adds nothing: no OGC-side grant, no OGC-side policy store (DEC-027 stays as written).
 *
 * Domain relations that only OGC knows — "is this the class's own teacher", "is this the session's
 * substitute" — are NOT decided here. The adapter establishes them and passes the result in as a
 * resource fact (`sessionRole`); authorize() then applies the role and the narrowing to that fact.
 *
 * Order (first failing check wins, fail-closed):
 *   1. cross_tenant — the resource belongs to another organization;
 *   2. role         — the IIOS role does not hold the action at all;
 *   3. center       — an active center is set and the resource is not in it (or has no center);
 *   4. unavailable  — IIOS could not resolve the narrowing policy;
 *   5. narrowing    — a policy applies and no rule for the action matches every condition.
 * Allowed → the read-only fields of the matching rules (their INTERSECTION — widest path wins).
 */

export interface AuthzResource {
  orgId: string; // the tenant root the resource belongs to
  centerId?: string; // the center it sits in, when it has one
  sessionRole?: SessionRole; // relation established by the adapter (owner / substitute)
}

export type AuthzDenial = "cross_tenant" | "role" | "center" | "unavailable" | "narrowing";

export type AuthzDecision =
  { allow: true; readonly: ReadonlyField[] } | { allow: false; reason: AuthzDenial };

/** Which IIOS actor roles hold each action before any narrowing. */
export function roleHolds(role: IiosGrantedContext["role"], action: PolicyAction): boolean {
  const entry = POLICY_CATALOG.find((c) => c.action === action);
  return !!entry && (entry.roles as string[]).includes(role);
}

function ruleMatches(rule: PolicyRule, res: AuthzResource): boolean {
  const c = rule.criteria ?? {};
  // A condition that needs a fact the operation does not carry does NOT match (fail-closed).
  if (c.centerId && (res.centerId === undefined || !c.centerId.includes(res.centerId)))
    return false;
  if (c.sessionRole && (res.sessionRole === undefined || !c.sessionRole.includes(res.sessionRole)))
    return false;
  return true;
}

/** Role ∩ policy rules for one action (shared by the mock store until it moves behind IIOS). */
export function evaluateRules(
  rules: PolicyRule[],
  action: PolicyAction,
  res: Omit<AuthzResource, "orgId">,
): { allow: true; readonly: ReadonlyField[] } | { allow: false } {
  const matching = rules.filter((r) => r.action === action && ruleMatches(r, res as AuthzResource));
  if (matching.length === 0) return { allow: false };
  let ro: ReadonlyField[] | null = null;
  for (const r of matching) {
    const f = r.readonlyFields ?? [];
    ro = ro === null ? [...f] : ro.filter((x) => f.includes(x));
  }
  return { allow: true, readonly: ro ?? [] };
}

export function authorize(
  ctx: IiosGrantedContext,
  action: PolicyAction,
  res: AuthzResource,
): AuthzDecision {
  if (res.orgId !== ctx.orgId) return { allow: false, reason: "cross_tenant" };
  if (!roleHolds(ctx.role, action)) return { allow: false, reason: "role" };
  if (ctx.activeCenter !== undefined && res.centerId !== ctx.activeCenter)
    return { allow: false, reason: "center" };
  const n = ctx.narrowing ?? { state: "none" as const };
  if (n.state === "none") return { allow: true, readonly: [] };
  if (n.state === "unavailable") return { allow: false, reason: "unavailable" };
  const v = evaluateRules(n.rules, action, res);
  return v.allow ? v : { allow: false, reason: "narrowing" };
}

/** Allowed AND `field` is not read-only for the matching rules. */
export function authorizeField(
  ctx: IiosGrantedContext,
  action: PolicyAction,
  res: AuthzResource,
  field: ReadonlyField,
): boolean {
  const d = authorize(ctx, action, res);
  return d.allow && !d.readonly.includes(field);
}
