/*
 * OGC-side enforcement of the IIOS-decided narrowing (OGC-ADR-039 steps 2–3b). SYNTHETIC, mock.
 *
 * Policies are no longer stored here: IIOS (mock: lib/integration/mockIiosPolicy.ts) stores and
 * decides them. This module only ENFORCES, through the contract's `authorize()`, using the same
 * tenant / role / narrowing IIOS would put into the persona's granted context.
 *
 * Step 3b: callers pass the IIOS-granted context itself (ports take it as their first argument);
 * nothing here looks up a persona.
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
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export interface Facts {
  centerId?: string;
  sessionRole?: SessionRole;
}
type Verdict = { ok: true; readonly: ReadonlyField[] } | { ok: false };

export function decide(ctx: IiosGrantedContext, action: PolicyAction, facts: Facts = {}): Verdict {
  // The resource's tenant: from its center when it has one; otherwise the adapter has already
  // refused resources outside the caller's tenant (fail-closed not_found).
  const orgId = facts.centerId
    ? (centers.find((c) => c.id === facts.centerId)?.orgId ?? "unknown")
    : ctx.orgId;
  const res: AuthzResource = { orgId, ...facts };
  const d = authorize(ctx, action, res);
  return d.allow ? { ok: true, readonly: d.readonly } : { ok: false };
}

export const allows = (ctx: IiosGrantedContext, action: PolicyAction, facts: Facts = {}): boolean =>
  decide(ctx, action, facts).ok;

/** Like allows(), but also refuses when `field` is read-only for the matching rules. */
export function allowsField(
  ctx: IiosGrantedContext,
  action: PolicyAction,
  facts: Facts,
  field: ReadonlyField,
): boolean {
  const v = decide(ctx, action, facts);
  return v.ok && !v.readonly.includes(field);
}

const narrowingOf = (ctx: IiosGrantedContext): GrantNarrowing => ctx.narrowing ?? { state: "none" };
const roleHas = (ctx: IiosGrantedContext, action: PolicyAction): boolean =>
  roleHolds(ctx.role, action);

/** Centers this persona may act on for an action (listing filter). */
export function centerScope(
  ctx: IiosGrantedContext,
  action: PolicyAction,
): string[] | "any" | "none" {
  if (!roleHas(ctx, action)) return "none";
  // IIOS active center (AZ7) narrows first.
  const within = (ids: string[] | "any") =>
    ctx.activeCenter === undefined
      ? ids
      : ids === "any" || ids.includes(ctx.activeCenter)
        ? [ctx.activeCenter]
        : [];
  const n = narrowingOf(ctx);
  if (n.state === "none") return within("any");
  if (n.state === "unavailable") return "none";
  const rules = n.rules.filter((r) => r.action === action);
  if (rules.length === 0) return "none";
  // A rule without a center condition applies at every center.
  if (rules.some((r) => !r.criteria?.centerId)) return within("any");
  return within([...new Set(rules.flatMap((r) => r.criteria?.centerId ?? []))]);
}

export const inScope = (scope: string[] | "any" | "none", centerId: string) =>
  scope === "any" || (scope !== "none" && scope.includes(centerId));

export const mockMyAccess: MyAccessPort = {
  myAccess: (viewer) =>
    withFault("access.myAccess", () => {
      const n: GrantNarrowing | null = narrowingOf(viewer);
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
