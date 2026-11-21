/*
 * Access policy store + decision (SYNTHETIC, mock; pattern from HealthcareOS HCOS-F2).
 *
 * effective = role permissions ∩ policy. A policy only ever NARROWS. Fail-closed when a membership
 * points at a policy that is missing or retired. Kept in this browser via persist.ts; "Reset demo
 * data" restores the seed (two example policies, attached to nobody).
 */
import {
  POLICY_CATALOG,
  PolicyRule,
  type AccessAdminView,
  type AccessPolicy,
  type AccessPolicyPort,
  type CriterionKey,
  type MyAccess,
  type PolicyAction,
  type PolicyInput,
  type PolicyRefusal,
  type PolicyResult,
  type PolicyVersion,
  type ReadonlyField,
  type SessionRole,
} from "@ogc/contracts";
import { centers, organizations } from "../../fixtures/directory";
import { members, personaMap } from "../../fixtures/personas";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

interface StoredPolicy {
  id: string;
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
  const frontDesk: PolicyRule[] = [
    {
      action: "schedule:manage",
      criteria: { centerId: [D1] },
      readonlyFields: ["classTeacher", "substitute"],
    },
    { action: "makeup:manage", criteria: { centerId: [D1] } },
  ];
  const ownClasses: PolicyRule[] = [
    { action: "attendance:mark", criteria: { sessionRole: ["owner"] } },
  ];
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
      frontDesk,
    ),
    mk(
      "policy-own-classes",
      "Teacher — own classes only",
      "Marks attendance for their own classes only, not as a substitute.",
      ownClasses,
    ),
  ];
}

const policies = new Map<string, StoredPolicy>();
const assignments = new Map<string, string>(); // personaId → policyId
let seq = 0;

function resetAccess(): void {
  policies.clear();
  for (const p of seedPolicies()) policies.set(p.id, p);
  assignments.clear();
  seq = 0;
}
resetAccess();
sessionStore.onReset(resetAccess);
export const __resetAccessForTests = resetAccess;

registerPersistent("access", {
  dump: () => ({ policies, assignments, seq }),
  load: (raw) => {
    const r = raw as { policies?: unknown; assignments?: unknown; seq?: number };
    refill(policies, r.policies);
    refill(assignments, r.assignments);
    seq = r.seq ?? 0;
  },
});

// ── decision ─────────────────────────────────────────────────────────────────────────────────

const ROLE_PERMISSIONS: Record<"staff" | "teacher", PolicyAction[]> = {
  staff: POLICY_CATALOG.filter((c) => c.roles.includes("staff")).map((c) => c.action),
  teacher: POLICY_CATALOG.filter((c) => c.roles.includes("teacher")).map((c) => c.action),
};

function rolePermits(personaId: string, action: PolicyAction): boolean {
  const p = personaMap[personaId];
  if (!p) return false;
  if (p.staff && ROLE_PERMISSIONS.staff.includes(action)) return true;
  if (p.teacherId && ROLE_PERMISSIONS.teacher.includes(action)) return true;
  return false;
}

export interface Facts {
  centerId?: string;
  sessionRole?: SessionRole;
}

type Verdict = { ok: true; readonly: ReadonlyField[] } | { ok: false };

/** The policy a membership must follow: undefined = none; null = fail-closed (missing / retired). */
function policyOf(personaId: string): StoredPolicy | null | undefined {
  const id = assignments.get(personaId);
  if (!id) return undefined;
  const p = policies.get(id);
  const orgId = personaMap[personaId]?.orgId;
  if (!p || p.status !== "active" || p.orgId !== orgId) return null;
  return p;
}

function ruleMatches(rule: PolicyRule, facts: Facts): boolean {
  const c = rule.criteria ?? {};
  for (const key of Object.keys(c) as CriterionKey[]) {
    const allowed = c[key] as string[] | undefined;
    if (!allowed) continue;
    const fact = facts[key];
    // A condition that needs a fact the operation does not have does NOT match (fail-closed).
    if (fact === undefined || !allowed.includes(fact)) return false;
  }
  return true;
}

/**
 * Role ∩ policy. With several matching rules the read-only fields are the INTERSECTION (the widest
 * path wins), as in HealthcareOS.
 */
export function decide(personaId: string, action: PolicyAction, facts: Facts = {}): Verdict {
  if (!rolePermits(personaId, action)) return { ok: false };
  const policy = policyOf(personaId);
  if (policy === undefined) return { ok: true, readonly: [] };
  if (policy === null) return { ok: false };
  const matching = policy.rules.filter((r) => r.action === action && ruleMatches(r, facts));
  if (matching.length === 0) return { ok: false };
  let ro: ReadonlyField[] | null = null;
  for (const r of matching) {
    const f = r.readonlyFields ?? [];
    ro = ro === null ? [...f] : ro.filter((x) => f.includes(x));
  }
  return { ok: true, readonly: ro ?? [] };
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

/** Centers this persona may act on for an action (listing filter). */
export function centerScope(personaId: string, action: PolicyAction): string[] | "any" | "none" {
  if (!rolePermits(personaId, action)) return "none";
  const policy = policyOf(personaId);
  if (policy === undefined) return "any";
  if (policy === null) return "none";
  const rules = policy.rules.filter((r) => r.action === action);
  if (rules.length === 0) return "none";
  // A rule without a center condition applies at every center.
  if (rules.some((r) => !r.criteria?.centerId)) return "any";
  return [...new Set(rules.flatMap((r) => r.criteria?.centerId ?? []))];
}

export const inScope = (scope: string[] | "any" | "none", centerId: string) =>
  scope === "any" || (scope !== "none" && scope.includes(centerId));

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

// ── admin view ──────────────────────────────────────────────────────────────────────────────

function adminOrg(viewer: string): string | null {
  const p = personaMap[viewer];
  return p?.admin ? p.orgId : null;
}
const nameOf = (personaId: string) =>
  members.find((m) => m.personaId === personaId)?.displayName ?? personaId;
const canHavePolicy = (role: string | null) =>
  role === "admin" || role === "staff" || role === "teacher";

function toPolicy(p: StoredPolicy, viewer: string): AccessPolicy {
  return {
    ...p,
    rules: p.rules.map((r) => structuredClone(r)),
    history: [...p.history].reverse().map((h) => structuredClone(h)),
    inUse: [...assignments.values()].filter((id) => id === p.id).length,
    restrictsYou: assignments.get(viewer) === p.id,
  };
}

function adminView(viewer: string, orgId: string): AccessAdminView {
  const orgMembers = members.filter((m) => m.orgId === orgId);
  const list = [...policies.values()].filter((p) => p.orgId === orgId);
  return {
    orgId,
    orgName: organizations.find((o) => o.id === orgId)?.name ?? "Organization",
    stats: {
      members: orgMembers.length,
      staffAndTeachers: orgMembers.filter((m) => canHavePolicy(m.role)).length,
      privileged: orgMembers.filter((m) => m.role === "admin").length,
      restricted: orgMembers.filter((m) => assignments.has(m.personaId)).length,
      noRole: orgMembers.filter((m) => m.role === null).length,
    },
    policies: list
      .sort((a, b) =>
        a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1,
      )
      .map((p) => toPolicy(p, viewer)),
    memberships: orgMembers.map((m) => {
      const pid = assignments.get(m.personaId) ?? null;
      return {
        personaId: m.personaId,
        displayName: m.displayName,
        role: m.role,
        policyId: pid,
        policyName: pid ? (policies.get(pid)?.name ?? "(missing policy)") : null,
        canHavePolicy: canHavePolicy(m.role),
        isYou: m.personaId === viewer,
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


export const mockAccessPolicy: AccessPolicyPort = {
  getAdminView: (viewer) =>
    withFault("access.getAdminView", () => {
      const org = adminOrg(viewer);
      return latency<AccessAdminView | null>(org ? adminView(viewer, org) : null);
    }),

  validate: (viewer, rules) =>
    withFault("access.validate", () => {
      const org = adminOrg(viewer);
      if (!org) return latency({ ok: false as const, detail: "not an Org Admin", path: "" });
      const bad = validateRules(org, rules);
      return latency(bad ? { ok: false as const, ...bad } : { ok: true as const });
    }),

  createPolicy: (viewer, input: PolicyInput) =>
    withFault("access.createPolicy", () => {
      const org = adminOrg(viewer);
      if (!org) return refuse("not_admin");
      const name = { data: (input.name ?? "").trim() };
      if (name.data.length < 3 || name.data.length > 100)
        return refuse("invalid", { detail: "name must be 3–100 characters", path: "name" });
      if (
        [...policies.values()].some(
          (p) => p.orgId === org && p.name.toLowerCase() === name.data.toLowerCase(),
        )
      )
        return refuse("name_taken");
      const bad = validateRules(org, input.rules);
      if (bad) return refuse("invalid", bad);
      const now = new Date().toISOString();
      const p: StoredPolicy = {
        id: `policy-${++seq}-${Date.now().toString(36)}`,
        orgId: org,
        name: name.data,
        description: input.description?.trim() || null,
        status: "active",
        rules: cleanRules(input.rules),
        version: 1,
        updatedAt: now,
        history: [],
      };
      snapshot(p, viewer, "created");
      policies.set(p.id, p);
      return okView(viewer, org);
    }),

  revisePolicy: (viewer, policyId, expectedVersion, patch) =>
    withFault("access.revisePolicy", () => {
      const org = adminOrg(viewer);
      if (!org) return refuse("not_admin");
      const p = policies.get(policyId);
      if (!p || p.orgId !== org) return refuse("not_found");
      if (p.status === "retired") return refuse("retired");
      if (assignments.get(viewer) === p.id) return refuse("self");
      if (p.version !== expectedVersion) return refuse("stale");
      if (patch.rules) {
        const bad = validateRules(org, patch.rules);
        if (bad) return refuse("invalid", bad);
        p.rules = cleanRules(patch.rules);
      }
      if (patch.description !== undefined) p.description = patch.description?.trim() || null;
      p.version += 1;
      p.updatedAt = new Date().toISOString();
      snapshot(p, viewer, "revised");
      return okView(viewer, org);
    }),

  retirePolicy: (viewer, policyId, expectedVersion) =>
    withFault("access.retirePolicy", () => {
      const org = adminOrg(viewer);
      if (!org) return refuse("not_admin");
      const p = policies.get(policyId);
      if (!p || p.orgId !== org) return refuse("not_found");
      if (p.status === "retired") return refuse("retired");
      if (assignments.get(viewer) === p.id) return refuse("self");
      if (p.version !== expectedVersion) return refuse("stale");
      if ([...assignments.values()].includes(p.id)) return refuse("in_use");
      p.status = "retired";
      p.version += 1;
      p.updatedAt = new Date().toISOString();
      snapshot(p, viewer, "retired");
      return okView(viewer, org);
    }),

  setMembershipPolicy: (viewer, member, policyId) =>
    withFault("access.setMembershipPolicy", () => {
      const org = adminOrg(viewer);
      if (!org) return refuse("not_admin");
      const m = members.find((x) => x.personaId === member && x.orgId === org);
      if (!m) return refuse("not_found");
      if (member === viewer) return refuse("self");
      if (!canHavePolicy(m.role)) return refuse("not_applicable");
      if (policyId === null) {
        assignments.delete(member);
        return okView(viewer, org);
      }
      const p = policies.get(policyId);
      if (!p || p.orgId !== org) return refuse("not_found");
      if (p.status !== "active") return refuse("retired");
      assignments.set(member, p.id);
      return okView(viewer, org);
    }),

  myAccess: (viewer) =>
    withFault("access.myAccess", () => {
      const policy = policyOf(viewer);
      const allowed = {} as Record<PolicyAction, boolean>;
      const scope: MyAccess["centers"] = {};
      const readonly: MyAccess["readonly"] = {};
      for (const { action } of POLICY_CATALOG) {
        const rules = policy ? policy.rules.filter((r) => r.action === action) : [];
        allowed[action] = rolePermits(viewer, action) && (policy === undefined || rules.length > 0);
        const s = centerScope(viewer, action);
        if (s !== "none") scope[action] = s;
        if (policy && rules.length) {
          let ro: ReadonlyField[] | null = null;
          for (const r of rules) {
            const f = r.readonlyFields ?? [];
            ro = ro === null ? [...f] : ro.filter((x) => f.includes(x));
          }
          if (ro?.length) readonly[action] = ro;
        }
      }
      return latency<MyAccess>({
        policyName: policy ? policy.name : policy === null ? "(unavailable policy)" : null,
        failedClosed: policy === null,
        allowed,
        centers: scope,
        readonly,
      });
    }),
};

/** Test / tamper hook: point a membership at a policy id directly (bypasses the admin rules). */
export const __assignForTests = (personaId: string, policyId: string | null) =>
  policyId === null ? assignments.delete(personaId) : assignments.set(personaId, policyId);
export const __policiesForTests = policies;
