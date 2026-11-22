/*
 * OGC-side enforcement of the IIOS-decided narrowing (OGC-ADR-039 step 2). SYNTHETIC, mock.
 *
 * Policies are no longer stored here: IIOS (mock: lib/integration/mockIiosPolicy.ts) stores and
 * decides them. This module only ENFORCES, through the contract's `authorize()`, using the same
 * tenant / role / narrowing IIOS would put into the persona's granted context.
 *
 * Interim (until step 3): adapters still receive a persona id, so the context is rebuilt here from
 * the persona's IIOS principal. Step 3 passes the real granted context into the adapters instead.
 */
import {
  authorize,
  roleHolds,
  POLICY_CATALOG,
  type AuthzResource,
  type GrantNarrowing,
  type IiosGrantedContext,
  type MyAccess,
  type MyAccessPort,
  type PolicyAction,
  type ReadonlyField,
  type SessionRole,
} from "@ogc/contracts";
import { personaMap, principalOf } from "../../fixtures/personas";
import { narrowingFor } from "../integration/mockIiosPolicy";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export interface Facts {
  centerId?: string;
  sessionRole?: SessionRole;
}
type Verdict = { ok: true; readonly: ReadonlyField[] } | { ok: false };

/** The granted context IIOS would issue for this persona (interim — see header). */
function contextOf(personaId: string): IiosGrantedContext | null {
  const p = personaMap[personaId];
  const principal = principalOf(personaId);
  if (!p || !principal) return null;
  const role = p.staff ? "staff" : p.teacherId ? "teacher" : p.guardianId ? "guardian" : "learner";
  return {
    clientId: "eduos",
    orgId: p.orgId,
    principalId: principal,
    role,
    purpose: "learning.read",
    requestId: "req-interim",
    grantRef: "interim",
    expiresAt: "2099-01-01T00:00:00.000Z",
    narrowing: narrowingFor(principal, p.orgId),
  };
}

export function decide(personaId: string, action: PolicyAction, facts: Facts = {}): Verdict {
  const ctx = contextOf(personaId);
  if (!ctx) return { ok: false };
  // Adapters have already refused resources outside the caller's tenant (fail-closed not_found),
  // so the resource is in ctx.orgId here.
  const res: AuthzResource = { orgId: ctx.orgId, ...facts };
  const d = authorize(ctx, action, res);
  return d.allow ? { ok: true, readonly: d.readonly } : { ok: false };
}

export const allows = (personaId: string, action: PolicyAction, facts: Facts = {}): boolean =>
  decide(personaId, action, facts).ok;

/** Like allows(), but also refuses when `field` is read-only for the matching rules. */
export function allowsField(
  personaId: string,
  action: PolicyAction,
  facts: Facts,
  field: ReadonlyField,
): boolean {
  const v = decide(personaId, action, facts);
  return v.ok && !v.readonly.includes(field);
}

const narrowingOf = (personaId: string): GrantNarrowing | null =>
  contextOf(personaId)?.narrowing ?? null;
const roleHas = (personaId: string, action: PolicyAction): boolean => {
  const ctx = contextOf(personaId);
  return !!ctx && roleHolds(ctx.role, action);
};

/** Centers this persona may act on for an action (listing filter). */
export function centerScope(personaId: string, action: PolicyAction): string[] | "any" | "none" {
  if (!roleHas(personaId, action)) return "none";
  const n = narrowingOf(personaId);
  if (!n || n.state === "none") return "any";
  if (n.state === "unavailable") return "none";
  const rules = n.rules.filter((r) => r.action === action);
  if (rules.length === 0) return "none";
  // A rule without a center condition applies at every center.
  if (rules.some((r) => !r.criteria?.centerId)) return "any";
  return [...new Set(rules.flatMap((r) => r.criteria?.centerId ?? []))];
}

export const inScope = (scope: string[] | "any" | "none", centerId: string) =>
  scope === "any" || (scope !== "none" && scope.includes(centerId));

export const mockMyAccess: MyAccessPort = {
  myAccess: (viewer) =>
    withFault("access.myAccess", () => {
      const n = narrowingOf(viewer);
      const allowed = {} as Record<PolicyAction, boolean>;
      const scope: MyAccess["centers"] = {};
      const readonly: MyAccess["readonly"] = {};
      for (const { action } of POLICY_CATALOG) {
        const rules = n?.state === "policy" ? n.rules.filter((r) => r.action === action) : [];
        allowed[action] =
          roleHas(viewer, action) &&
          n?.state !== "unavailable" &&
          (n?.state !== "policy" || rules.length > 0);
        const s = centerScope(viewer, action);
        if (s !== "none") scope[action] = s;
        if (rules.length) {
          let ro: ReadonlyField[] | null = null;
          for (const r of rules) {
            const f = r.readonlyFields ?? [];
            ro = ro === null ? [...f] : ro.filter((x) => f.includes(x));
          }
          if (ro?.length) readonly[action] = ro;
        }
      }
      return latency<MyAccess>({
        policyName:
          n?.state === "policy"
            ? n.name
            : n?.state === "unavailable"
              ? "(unavailable policy)"
              : null,
        failedClosed: n?.state === "unavailable",
        allowed,
        centers: scope,
        readonly,
      });
    }),
};
