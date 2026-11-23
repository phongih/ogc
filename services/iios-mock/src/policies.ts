/*
 * MOCK IIOS — access policies (OGC-ADR-039 option C, ADR-040). IIOS STORES and DECIDES; OGC's Access
 * page only edits through the API. The rules are the demo's (apps/web/src/lib/integration/
 * mockIiosPolicy.ts, HCOS-F2 pattern):
 *  - closed catalog: an unknown action / condition / read-only field is refused with a `path`;
 *  - narrow-only (role ∩ policy) and fail-closed: attached but missing / retired → "unavailable";
 *  - optimistic versioning (`expectedVersion`), append-only history, a retired policy is final,
 *    no retiring while in use;
 *  - an Org Admin is decided from IIOS's own member data, never from a caller's flag, and never
 *    changes their own membership or a policy that narrows them.
 * The logic is pure: an operation reads the organization's state and returns its result plus the
 * changes to persist. `PolicyStore` keeps the state — in memory (tests) or in PostgreSQL (pgStore).
 */
import {
  POLICY_CATALOG,
  PolicyRule,
  type AccessAdminView,
  type AccessPolicy,
  type CriterionKey,
  type GrantNarrowing,
  type PolicyInput,
  type PolicyRefusal,
  type PolicyResult,
  type PolicyVersion,
} from "@ogc/contracts";
import { MEMBERS, ORGS, type Member } from "./seed.js";

export interface PolicyRecord {
  ref: string;
  orgId: string;
  name: string;
  description: string | null;
  version: number;
  status: "active" | "retired";
  rules: PolicyRule[];
  updatedAt: string;
  history: PolicyVersion[]; // oldest first
}

/** One organization's policies and which of its members has which policy. */
export interface OrgPolicies {
  policies: PolicyRecord[];
  attachments: Map<string, string>; // principalId → policy ref
}

export type Change =
  | { kind: "policy"; policy: PolicyRecord; entry: PolicyVersion } // upsert + one history row
  | { kind: "attach"; principalId: string; orgId: string; ref: string | null };

export interface PolicyStore {
  read(orgId: string): Promise<OrgPolicies>;
  /** Run `op` on the organization's current state and persist its changes, one org at a time. */
  write<T>(orgId: string, op: (s: OrgPolicies) => { result: T; changes: Change[] }): Promise<T>;
}

// ── memory store (tests, local dev) ──────────────────────────────────────────────────────────

export function memoryStore(state: {
  policies: Map<string, PolicyRecord>;
  attachments: Map<string, string>;
}): PolicyStore {
  let chain = Promise.resolve();
  const read = async (orgId: string): Promise<OrgPolicies> => ({
    policies: [...state.policies.values()]
      .filter((p) => p.orgId === orgId)
      .map((p) => structuredClone(p)),
    attachments: new Map(
      [...state.attachments].filter(([pid]) =>
        MEMBERS.some((m) => m.principalId === pid && m.orgId === orgId),
      ),
    ),
  });
  return {
    read,
    write(orgId, op) {
      const run = chain.then(async () => {
        const { result, changes } = op(await read(orgId));
        for (const c of changes) {
          if (c.kind === "policy") {
            const prev = state.policies.get(c.policy.ref);
            state.policies.set(c.policy.ref, {
              ...structuredClone(c.policy),
              history: [...(prev?.history ?? []), structuredClone(c.entry)],
            });
          } else if (c.ref === null) state.attachments.delete(c.principalId);
          else state.attachments.set(c.principalId, c.ref);
        }
        return result;
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

// ── what goes into the grant ─────────────────────────────────────────────────────────────────

export function narrowingFor(m: Member, s: OrgPolicies): GrantNarrowing {
  if (m.role === "admin") return { state: "none" }; // an Org Admin is never narrowed
  const ref = s.attachments.get(m.principalId);
  if (!ref) return { state: "none" };
  const p = s.policies.find((x) => x.ref === ref);
  if (!p || p.status !== "active" || p.orgId !== m.orgId || p.rules.length === 0)
    return { state: "unavailable" }; // fail-closed: attached but unresolvable
  return { state: "policy", policyRef: p.ref, version: p.version, name: p.name, rules: p.rules };
}

// ── validation (closed catalog) ──────────────────────────────────────────────────────────────

type Invalid = { detail: string; path: string };

export function validateRules(orgId: string, raw: unknown): Invalid | null {
  if (!Array.isArray(raw)) return { detail: "rules must be a list", path: "rules" };
  if (raw.length < 1 || raw.length > 20)
    return { detail: "a policy needs 1–20 rules", path: "rules" };
  const orgCenters = new Set(ORGS.find((o) => o.id === orgId)?.centers.map((c) => c.id) ?? []);
  for (let i = 0; i < raw.length; i++) {
    const parsed = PolicyRule.safeParse(raw[i]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        detail: `unknown or malformed: ${issue.message}`,
        path: `rules[${i}]${issue.path.length ? "." + issue.path.join(".") : ""}`,
      };
    }
    const rule = parsed.data;
    const entry = POLICY_CATALOG.find((c) => c.action === rule.action)!;
    for (const key of Object.keys(rule.criteria ?? {}) as CriterionKey[])
      if (!entry.criteria.includes(key))
        return {
          detail: `${rule.action} has no "${key}" condition`,
          path: `rules[${i}].criteria.${key}`,
        };
    const cs = rule.criteria?.centerId ?? [];
    for (let j = 0; j < cs.length; j++)
      if (!orgCenters.has(cs[j]))
        return { detail: "unknown center", path: `rules[${i}].criteria.centerId[${j}]` };
    const ro = rule.readonlyFields ?? [];
    for (let j = 0; j < ro.length; j++)
      if (!entry.readonlyFields.includes(ro[j]))
        return {
          detail: `${rule.action} has no read-only field "${ro[j]}"`,
          path: `rules[${i}].readonlyFields[${j}]`,
        };
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

// ── admin operations ─────────────────────────────────────────────────────────────────────────

const canHavePolicy = (role: string | null) =>
  role === "admin" || role === "staff" || role === "teacher";
const nameOf = (pid: string) => MEMBERS.find((m) => m.principalId === pid)?.displayName ?? pid;
const memberOf = (pid: string, orgId: string) =>
  MEMBERS.find((m) => m.principalId === pid && m.orgId === orgId);

/** IIOS membership attribute: does this principal administer the org's access policies? */
export const isOrgAdmin = (pid: string, orgId: string) => memberOf(pid, orgId)?.role === "admin";

export function adminView(s: OrgPolicies, viewer: string, orgId: string): AccessAdminView {
  const org = ORGS.find((o) => o.id === orgId);
  const orgMembers = MEMBERS.filter((m) => m.orgId === orgId);
  const toPolicy = (p: PolicyRecord): AccessPolicy => ({
    id: p.ref,
    orgId: p.orgId,
    name: p.name,
    description: p.description,
    status: p.status,
    rules: structuredClone(p.rules),
    version: p.version,
    updatedAt: p.updatedAt,
    inUse: [...s.attachments.values()].filter((r) => r === p.ref).length,
    restrictsYou: s.attachments.get(viewer) === p.ref,
    history: [...p.history].reverse().map((h) => structuredClone(h)),
  });
  return {
    orgId,
    orgName: org?.name ?? "Organization",
    stats: {
      members: orgMembers.length,
      staffAndTeachers: orgMembers.filter((m) => canHavePolicy(m.role)).length, // as the demo
      privileged: orgMembers.filter((m) => m.role === "admin").length,
      restricted: orgMembers.filter((m) => s.attachments.has(m.principalId)).length,
      noRole: orgMembers.filter((m) => m.role === null).length,
    },
    policies: [...s.policies]
      .sort((a, b) =>
        a.status === b.status ? a.name.localeCompare(b.name) : a.status === "active" ? -1 : 1,
      )
      .map(toPolicy),
    memberships: orgMembers.map((m) => {
      const ref = s.attachments.get(m.principalId) ?? null;
      return {
        principalId: m.principalId,
        displayName: m.displayName,
        role: m.role,
        policyId: ref,
        policyName: ref
          ? (s.policies.find((p) => p.ref === ref)?.name ?? "(missing policy)")
          : null,
        canHavePolicy: canHavePolicy(m.role),
        isYou: m.principalId === viewer,
      };
    }),
    centers: org?.centers.map((c) => ({ ...c })) ?? [],
  };
}

type Op = { result: PolicyResult; changes: Change[] };
const refuse = (reason: PolicyRefusal, extra: { detail?: string; path?: string } = {}): Op => ({
  result: { ok: false, reason, ...extra },
  changes: [],
});

/** Apply `changes` to a copy of `s` so the returned view shows the state after the write. */
function after(s: OrgPolicies, changes: Change[]): OrgPolicies {
  const policies = new Map(s.policies.map((p) => [p.ref, p]));
  const attachments = new Map(s.attachments);
  for (const c of changes)
    if (c.kind === "policy") {
      const prev = policies.get(c.policy.ref);
      policies.set(c.policy.ref, { ...c.policy, history: [...(prev?.history ?? []), c.entry] });
    } else if (c.ref === null) attachments.delete(c.principalId);
    else attachments.set(c.principalId, c.ref);
  return { policies: [...policies.values()], attachments };
}

function done(s: OrgPolicies, viewer: string, orgId: string, changes: Change[]): Op {
  return { result: { ok: true, view: adminView(after(s, changes), viewer, orgId) }, changes };
}

function entry(p: PolicyRecord, viewer: string, change: PolicyVersion["change"]): PolicyVersion {
  return {
    version: p.version,
    status: p.status,
    description: p.description,
    rules: structuredClone(p.rules),
    changedBy: nameOf(viewer),
    changedAt: p.updatedAt,
    change,
  };
}

export interface AdminCall {
  viewer: string; // the caller's principal, from the grant IIOS opened itself
  orgId: string;
  nowIso: string;
  newRef: () => string;
}

export const ops = {
  create(s: OrgPolicies, c: AdminCall, input: PolicyInput): Op {
    if (!isOrgAdmin(c.viewer, c.orgId)) return refuse("not_admin");
    const name = typeof input?.name === "string" ? input.name.trim() : "";
    if (name.length < 3 || name.length > 100)
      return refuse("invalid", { detail: "name must be 3–100 characters", path: "name" });
    if (s.policies.some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return refuse("name_taken");
    const bad = validateRules(c.orgId, input.rules);
    if (bad) return refuse("invalid", bad);
    const p: PolicyRecord = {
      ref: c.newRef(),
      orgId: c.orgId,
      name,
      description: (typeof input.description === "string" && input.description.trim()) || null,
      status: "active",
      rules: cleanRules(input.rules),
      version: 1,
      updatedAt: c.nowIso,
      history: [],
    };
    return done(s, c.viewer, c.orgId, [
      { kind: "policy", policy: p, entry: entry(p, c.viewer, "created") },
    ]);
  },

  revise(
    s: OrgPolicies,
    c: AdminCall,
    ref: string,
    expectedVersion: number,
    patch: { description?: string | null; rules?: PolicyRule[] },
  ): Op {
    if (!isOrgAdmin(c.viewer, c.orgId)) return refuse("not_admin");
    const cur = s.policies.find((p) => p.ref === ref);
    if (!cur) return refuse("not_found");
    if (cur.status === "retired") return refuse("retired");
    if (s.attachments.get(c.viewer) === ref) return refuse("self");
    if (cur.version !== expectedVersion) return refuse("stale");
    const p: PolicyRecord = { ...cur, history: [] };
    if (patch.rules !== undefined) {
      const bad = validateRules(c.orgId, patch.rules);
      if (bad) return refuse("invalid", bad);
      p.rules = cleanRules(patch.rules);
    }
    if (patch.description !== undefined)
      p.description = (typeof patch.description === "string" && patch.description.trim()) || null;
    p.version += 1;
    p.updatedAt = c.nowIso;
    return done(s, c.viewer, c.orgId, [
      { kind: "policy", policy: p, entry: entry(p, c.viewer, "revised") },
    ]);
  },

  retire(s: OrgPolicies, c: AdminCall, ref: string, expectedVersion: number): Op {
    if (!isOrgAdmin(c.viewer, c.orgId)) return refuse("not_admin");
    const cur = s.policies.find((p) => p.ref === ref);
    if (!cur) return refuse("not_found");
    if (cur.status === "retired") return refuse("retired");
    if (s.attachments.get(c.viewer) === ref) return refuse("self");
    if (cur.version !== expectedVersion) return refuse("stale");
    if ([...s.attachments.values()].includes(ref)) return refuse("in_use");
    const p: PolicyRecord = {
      ...cur,
      history: [],
      status: "retired",
      version: cur.version + 1,
      updatedAt: c.nowIso,
    };
    return done(s, c.viewer, c.orgId, [
      { kind: "policy", policy: p, entry: entry(p, c.viewer, "retired") },
    ]);
  },

  attach(s: OrgPolicies, c: AdminCall, member: string, ref: string | null): Op {
    if (!isOrgAdmin(c.viewer, c.orgId)) return refuse("not_admin");
    const m = memberOf(member, c.orgId);
    if (!m) return refuse("not_found");
    if (member === c.viewer) return refuse("self");
    if (!canHavePolicy(m.role)) return refuse("not_applicable");
    if (ref !== null) {
      const p = s.policies.find((x) => x.ref === ref);
      if (!p) return refuse("not_found");
      if (p.status !== "active") return refuse("retired");
    }
    return done(s, c.viewer, c.orgId, [
      { kind: "attach", principalId: member, orgId: c.orgId, ref },
    ]);
  },
};
