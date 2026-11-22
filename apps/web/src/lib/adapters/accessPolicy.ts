/*
 * OGC-side enforcement of the IIOS-decided narrowing (OGC-ADR-039 steps 2–3). SYNTHETIC, mock.
 *
 * Policies are no longer stored here: IIOS (mock: lib/integration/mockIiosPolicy.ts) stores and
 * decides them. This module only ENFORCES, through the contract's `authorize()`, using the same
 * tenant / role / narrowing IIOS would put into the persona's granted context.
 *
 * Step 3: the context is the grant IIOS actually decided (recorded by the IIOS gate on every
 * navigation, see lib/integration/currentGrant.ts) — its role, tenant and narrowing. A denied grant
 * leaves nothing allowed.
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
import { centers } from "../../fixtures/directory";
import { grantFor } from "../integration/currentGrant";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export interface Facts {
  centerId?: string;
  sessionRole?: SessionRole;
}
type Verdict = { ok: true; readonly: ReadonlyField[] } | { ok: false };

/** The grant IIOS decided for this persona (step 3: no longer rebuilt from OGC fixtures). */
const contextOf = (personaId: string): IiosGrantedContext | null => grantFor(personaId);

export function decide(personaId: string, action: PolicyAction, facts: Facts = {}): Verdict {
  const ctx = contextOf(personaId);
  if (!ctx) return { ok: false };
  // The resource's tenant: from its center when it has one; otherwise the adapter has already
  // refused resources outside the caller's tenant (fail-closed not_found).
  const orgId = facts.centerId
    ? (centers.find((c) => c.id === facts.centerId)?.orgId ?? "unknown")
    : ctx.orgId;
  const res: AuthzResource = { orgId, ...facts };
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
