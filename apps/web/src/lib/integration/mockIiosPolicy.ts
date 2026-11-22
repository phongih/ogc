/*
 * OGC-ADR-039 step 2 — MOCK IIOS policy service (SYNTHETIC; proves nothing about production IIOS).
 *
 * Option C (owner, 22/11): IIOS STORES and DECIDES access policies. This module plays IIOS: it keeps
 * the policies and their attachment to IIOS principals, answers `IiosPolicyAdminPort` for an Org
 * Admin, and computes the `narrowing` that goes into each granted context. OGC keeps no copy and
 * writes no authorization relation (DEC-027) — the Access page only calls this port.
 *
 * Rules carried over from PR #38 (HCOS-F2 pattern): closed catalog, refused on save with a path;
 * narrow-only; fail-closed (missing / retired → "unavailable"); optimistic versioning; append-only
 * history; an Org Admin never changes their own access or a policy that narrows them.
 * Kept in this browser via persist.ts (key "iiosPolicy"); "Reset demo data" restores the seed.
 */
import {
  POLICY_CATALOG,
  PolicyRule,
  type AccessAdminView,
  type AccessPolicy,
  type CriterionKey,
  type GrantNarrowing,
  type IiosGrantedContext,
  type IiosPolicyAdminPort,
  type PolicyRefusal,
  type PolicyResult,
  type PolicyVersion,
} from "@ogc/contracts";
import { centers, organizations } from "../../fixtures/directory";
import { members } from "../../fixtures/personas";
import { refill, registerPersistent } from "../adapters/persist";
import { sessionStore } from "../adapters/sessionStore";
import { withFault } from "../adapters/faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

interface StoredPolicy {
  id: string; // the IIOS policy reference
  orgId: string;
  name: string;
  description: string | null;
  status: "active" | "retired";
  rules: PolicyRule[];
  version: number;
  updatedAt: string;
  history: PolicyVersion[];
}

const ORG = organizations[0].id;
const D1 = centers[0].id; // Nova English — District 1
const SEED_AT = "2026-11-01T02:00:00.000Z";

function seedPolicies(): StoredPolicy[] {
  const mk = (
    id: string,
    name: string,
    description: string,
    rules: PolicyRule[],
  ): StoredPolicy => ({
    id,
    orgId: ORG,
    name,
    description,
    status: "active",
    rules,
    version: 1,
    updatedAt: SEED_AT,
    history: [
      {
        version: 1,
        status: "active",
        description,
        rules,
        changedBy: "Olivia (Org Admin)",
        changedAt: SEED_AT,
        change: "created",
      },
    ],
  });
  return [
    mk(
      "policy-front-desk-d1",
      "Front desk — District 1 only",
      "Schedule and make-ups for District 1 only; cannot change class teachers or substitutes.",
      [
        {
          action: "schedule:manage",
          criteria: { centerId: [D1] },
          readonlyFields: ["classTeacher", "substitute"],
        },
        { action: "makeup:manage", criteria: { centerId: [D1] } },
      ],
    ),
    mk(
      "policy-own-classes",
      "Teacher — own classes only",
      "Marks attendance for their own classes only, not as a substitute.",
      [{ action: "attendance:mark", criteria: { sessionRole: ["owner"] } }],
    ),
  ];
}

const policies = new Map<string, StoredPolicy>();
const attachments = new Map<string, string>(); // IIOS principalId → policy id
let seq = 0;

function resetPolicies(): void {
  policies.clear();
  for (const p of seedPolicies()) policies.set(p.id, p);
  attachments.clear();
  seq = 0;
}
resetPolicies();
sessionStore.onReset(resetPolicies);
export const __resetIiosPolicyForTests = resetPolicies;

registerPersistent("iiosPolicy", {
  dump: () => ({ policies, attachments, seq }),
  load: (raw) => {
    const r = raw as { policies?: unknown; attachments?: unknown; seq?: number };
    refill(policies, r.policies);
    refill(attachments, r.attachments);
    seq = r.seq ?? 0;
  },
});

// ── what goes into the grant ────────────────────────────────────────────────────────────────

const memberOf = (principalId: string, orgId: string) =>
  members.find((m) => m.principalId === principalId && m.orgId === orgId);

/** IIOS membership attribute: does this principal administer the org's access policies? */
export const isOrgAdmin = (principalId: string, orgId: string): boolean =>
  memberOf(principalId, orgId)?.role === "admin";

/** The narrowing IIOS decides for a principal in an org (fail-closed on missing / retired). */
export function narrowingFor(principalId: string, orgId: string): GrantNarrowing {
  const id = attachments.get(principalId);
  if (!id) return { state: "none" };
  const p = policies.get(id);
  if (!p || p.status !== "active" || p.orgId !== orgId) return { state: "unavailable" };
  return {
    state: "policy",
    policyRef: p.id,
    version: p.version,
    name: p.name,
    rules: structuredClone(p.rules),
  };
}

// ── validation (closed catalog) ──────────────────────────────────────────────────────────────

type Invalid = { detail: string; path: string };

function validateRules(orgId: string, raw: unknown): Invalid | null {
  if (!Array.isArray(raw)) return { detail: "rules must be a list", path: "rules" };
  if (raw.length < 1 || raw.length > 20)
    return { detail: "a policy needs 1–20 rules", path: "rules" };
  const orgCenters = new Set(centers.filter((c) => c.orgId === orgId).map((c) => c.id));
  for (let i = 0; i < raw.length; i++) {
    const parsed = PolicyRule.safeParse(raw[i]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        detail: `unknown or malformed: ${issue.message}`,
        path: `rules[${i}].${issue.path.join(".")}`,
      };
    }
    const rule = parsed.data;
    const entry = POLICY_CATALOG.find((c) => c.action === rule.action)!;
    for (const key of Object.keys(rule.criteria ?? {}) as CriterionKey[]) {
      if (!entry.criteria.includes(key))
        return {
          detail: `${rule.action} has no "${key}" condition`,
          path: `rules[${i}].criteria.${key}`,
        };
    }
    const cs = rule.criteria?.centerId ?? [];
    for (let j = 0; j < cs.length; j++)
      if (!orgCenters.has(cs[j]))
        return { detail: "unknown center", path: `rules[${i}].criteria.centerId[${j}]` };
    for (let j = 0; j < (rule.readonlyFields ?? []).length; j++) {
      const f = rule.readonlyFields![j];
      if (!entry.readonlyFields.includes(f))
        return {
          detail: `${rule.action} has no read-only field "${f}"`,
          path: `rules[${i}].readonlyFields[${j}]`,
        };
    }
  }
  return null;
}

const cleanRules = (rules: PolicyRule[]): PolicyRule[] =>
  rules.map((r) => {
    const out: PolicyRule = { action: r.action };
    const c: NonNullable<PolicyRule["criteria"]> = {};
    if (r.criteria?.centerId?.length) c.centerId = [...new Set(r.criteria.centerId)];
    if (r.criteria?.sessionRole?.length) c.sessionRole = [...new Set(r.criteria.sessionRole)];
    if (Object.keys(c).length) out.criteria = c;
    if (r.readonlyFields?.length) out.readonlyFields = [...new Set(r.readonlyFields)];
    return out;
  });

// ── admin port ──────────────────────────────────────────────────────────────────────────────

// IIOS decides from its own membership data, never from a flag the caller could set: the grant's
// `orgAdmin` is informational for OGC's UI; here IIOS re-checks the principal itself.
const adminOrg = (ctx: IiosGrantedContext): string | null =>
  isOrgAdmin(ctx.principalId, ctx.orgId) ? ctx.orgId : null;

const canHavePolicy = (role: string | null) =>
  role === "admin" || role === "staff" || role === "teacher";
const nameOf = (principalId: string) =>
  members.find((m) => m.principalId === principalId)?.displayName ?? principalId;

function toPolicy(p: StoredPolicy, viewer: string): AccessPolicy {
  return {
    ...p,
    rules: p.rules.map((r) => structuredClone(r)),
    history: [...p.history].reverse().map((h) => structuredClone(h)),
    inUse: [...attachments.values()].filter((id) => id === p.id).length,
    restrictsYou: attachments.get(viewer) === p.id,
  };
}

function adminView(viewer: string, orgId: string): AccessAdminView {
  const orgMembers = members.filter((m) => m.orgId === orgId);
  return {
    orgId,
    orgName: organizations.find((o) => o.id === orgId)?.name ?? "Organization",
    stats: {
      members: orgMembers.length,
      staffAndTeachers: orgMembers.filter((m) => canHavePolicy(m.role)).length,
      privileged: orgMembers.filter((m) => m.role === "admin").length,
      restricted: orgMembers.filter((m) => attachments.has(m.principalId)).length,
      noRole: orgMembers.filter((m) => m.role === null).length,
    },
    policies: [...policies.values()]
      .filter((p) => p.orgId === orgId)
      .sort((a, b) =>
        a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1,
      )
      .map((p) => toPolicy(p, viewer)),
    memberships: orgMembers.map((m) => {
      const pid = attachments.get(m.principalId) ?? null;
      return {
        principalId: m.principalId,
        displayName: m.displayName,
        role: m.role,
        policyId: pid,
        policyName: pid ? (policies.get(pid)?.name ?? "(missing policy)") : null,
        canHavePolicy: canHavePolicy(m.role),
        isYou: m.principalId === viewer,
      };
    }),
    centers: centers.filter((c) => c.orgId === orgId).map((c) => ({ id: c.id, name: c.name })),
  };
}

const refuse = (reason: PolicyRefusal, extra: { detail?: string; path?: string } = {}) =>
  latency<PolicyResult>({ ok: false, reason, ...extra });
const okView = (viewer: string, orgId: string) =>
  latency<PolicyResult>({ ok: true, view: adminView(viewer, orgId) });

function snapshot(p: StoredPolicy, viewer: string, change: PolicyVersion["change"]): void {
  p.history.push({
    version: p.version,
    status: p.status,
    description: p.description,
    rules: structuredClone(p.rules),
    changedBy: nameOf(viewer),
    changedAt: p.updatedAt,
    change,
  });
}

export const mockIiosPolicyAdmin: IiosPolicyAdminPort = {
  getAdminView: (ctx) =>
    withFault("iiosPolicy.getAdminView", () => {
      const org = adminOrg(ctx);
      return latency<AccessAdminView | null>(org ? adminView(ctx.principalId, org) : null);
    }),

  createPolicy: (ctx, input) =>
    withFault("iiosPolicy.createPolicy", () => {
      const org = adminOrg(ctx);
      if (!org) return refuse("not_admin");
      const name = (input.name ?? "").trim();
      if (name.length < 3 || name.length > 100)
        return refuse("invalid", { detail: "name must be 3–100 characters", path: "name" });
      if (
        [...policies.values()].some(
          (p) => p.orgId === org && p.name.toLowerCase() === name.toLowerCase(),
        )
      )
        return refuse("name_taken");
      const bad = validateRules(org, input.rules);
      if (bad) return refuse("invalid", bad);
      const p: StoredPolicy = {
        id: `policy-${++seq}-${Date.now().toString(36)}`,
        orgId: org,
        name,
        description: input.description?.trim() || null,
        status: "active",
        rules: cleanRules(input.rules),
        version: 1,
        updatedAt: new Date().toISOString(),
        history: [],
      };
      snapshot(p, ctx.principalId, "created");
      policies.set(p.id, p);
      return okView(ctx.principalId, org);
    }),

  revisePolicy: (ctx, policyRef, expectedVersion, patch) =>
    withFault("iiosPolicy.revisePolicy", () => {
      const org = adminOrg(ctx);
      if (!org) return refuse("not_admin");
      const p = policies.get(policyRef);
      if (!p || p.orgId !== org) return refuse("not_found");
      if (p.status === "retired") return refuse("retired");
      if (attachments.get(ctx.principalId) === p.id) return refuse("self");
      if (p.version !== expectedVersion) return refuse("stale");
      if (patch.rules) {
        const bad = validateRules(org, patch.rules);
        if (bad) return refuse("invalid", bad);
        p.rules = cleanRules(patch.rules);
      }
      if (patch.description !== undefined) p.description = patch.description?.trim() || null;
      p.version += 1;
      p.updatedAt = new Date().toISOString();
      snapshot(p, ctx.principalId, "revised");
      return okView(ctx.principalId, org);
    }),

  retirePolicy: (ctx, policyRef, expectedVersion) =>
    withFault("iiosPolicy.retirePolicy", () => {
      const org = adminOrg(ctx);
      if (!org) return refuse("not_admin");
      const p = policies.get(policyRef);
      if (!p || p.orgId !== org) return refuse("not_found");
      if (p.status === "retired") return refuse("retired");
      if (attachments.get(ctx.principalId) === p.id) return refuse("self");
      if (p.version !== expectedVersion) return refuse("stale");
      if ([...attachments.values()].includes(p.id)) return refuse("in_use");
      p.status = "retired";
      p.version += 1;
      p.updatedAt = new Date().toISOString();
      snapshot(p, ctx.principalId, "retired");
      return okView(ctx.principalId, org);
    }),

  attachPolicy: (ctx, member, policyRef) =>
    withFault("iiosPolicy.attachPolicy", () => {
      const org = adminOrg(ctx);
      if (!org) return refuse("not_admin");
      const m = memberOf(member, org);
      if (!m) return refuse("not_found");
      if (member === ctx.principalId) return refuse("self");
      if (!canHavePolicy(m.role)) return refuse("not_applicable");
      if (policyRef === null) {
        attachments.delete(member);
        return okView(ctx.principalId, org);
      }
      const p = policies.get(policyRef);
      if (!p || p.orgId !== org) return refuse("not_found");
      if (p.status !== "active") return refuse("retired");
      attachments.set(member, p.id);
      return okView(ctx.principalId, org);
    }),
};

/** Test / tamper hooks (bypass the admin rules) — synthetic state only. */
export const __attachForTests = (principalId: string, policyId: string | null) =>
  policyId === null ? attachments.delete(principalId) : attachments.set(principalId, policyId);
export const __policiesForTests = policies;
