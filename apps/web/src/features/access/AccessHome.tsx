/*
 * Access (Org Admin) — pattern from HealthcareOS HCOS-F2. OGC-ADR-039 step 2: policies are stored
 * and decided by IIOS (mock); this page is only the editing UI and calls IiosPolicyAdminPort with
 * the admin's own granted context. Owner decisions 22/11:
 *  - OGC does not create, lock or delete accounts: memberships come from the organization
 *    (EduOS / IIOS, mock) and are listed read-only here;
 *  - an access policy only NARROWS what a role allows, never grants; a closed catalog of actions;
 *  - only the Org Admin manages policies, and never their own.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CRITERION_LABEL,
  POLICY_CATALOG,
  READONLY_LABEL,
  type AccessAdminView,
  type AccessPolicy,
  type IiosGrantedContext,
  type PolicyAction,
  type PolicyResult,
  type PolicyRule,
  type ReadonlyField,
  type SessionRole,
} from "@ogc/contracts";
import { iiosPolicyAdmin } from "../../lib/api";
import { useGrantedContext } from "../../app/iiosGate";
import { useSession } from "../../app/session";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDateTime } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";

const REFUSAL: Record<string, string> = {
  not_admin: "Only the Org Admin manages access policies.",
  not_found: "That policy or member no longer exists.",
  invalid: "The policy is not valid",
  name_taken: "Another policy already has that name.",
  stale: "Someone changed this policy meanwhile — reload it and try again.",
  retired: "A retired policy is final.",
  in_use: "Still attached to members — detach it from them first.",
  self: "You cannot change your own access, or a policy that restricts you. Another Org Admin must.",
  not_applicable: "Learners, guardians and members with no role take no access policy.",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Org Admin",
  staff: "Center staff",
  teacher: "Teacher",
  learner: "Learner",
  guardian: "Guardian",
};

function useAccessAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<PolicyResult>) => run(),
    onSuccess: (r) => {
      if (r.ok) return refreshLearningState(qc);
    },
  });
}

function Refusal({ result }: { result: PolicyResult | undefined }) {
  if (!result || result.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[result.reason] ?? result.reason}
      {result.detail ? `: ${result.detail}` : ""}
      {result.path ? <code className="ml-1 text-xs">({result.path})</code> : null}
    </p>
  );
}

export function AccessHome() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  const ctx = useGrantedContext();
  const q = useQuery({
    queryKey: ["access-admin", viewer],
    queryFn: () => iiosPolicyAdmin.getAdminView(ctx!),
    enabled: !!viewer && !!ctx,
  });
  const [editing, setEditing] = useState<AccessPolicy | "new" | null>(null);

  if (q.isLoading) return <Spinner label="Loading access" />;
  if (q.isError) return <ErrorState message="Could not load access." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Access policies are for the Org Admin" />;
  const v = q.data;

  return (
    <section className="space-y-8">
      <PageHeader title="Access" subtitle={`${v.orgName} · synthetic demo`} />
      <p className="text-xs text-muted">
        People and their memberships come from the organization (EduOS / IIOS). OGC does not create,
        lock or delete accounts. An access policy only <strong>narrows</strong> what a role already
        allows — it never grants more. No policy means the role’s normal access.
      </p>
      <Stats view={v} />

      <section aria-label="Access policies" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-medium">Access policies</h2>
          <Button onClick={() => setEditing("new")}>+ New policy</Button>
        </div>
        {editing ? (
          <PolicyEditor
            key={editing === "new" ? "new" : `${editing.id}@${editing.version}`}
            ctx={ctx!}
            view={v}
            policy={editing === "new" ? null : editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
        <PolicyTable ctx={ctx!} view={v} onEdit={(p) => setEditing(p)} />
      </section>

      <Members ctx={ctx!} view={v} />
      <Catalog />
    </section>
  );
}

function Stats({ view }: { view: AccessAdminView }) {
  const cards = [
    { label: "Members", value: view.stats.members, hint: "in this organization" },
    { label: "Staff & teachers", value: view.stats.staffAndTeachers, hint: "can take a policy" },
    { label: "Privileged", value: view.stats.privileged, hint: "Org Admin" },
    { label: "Restricted", value: view.stats.restricted, hint: "by an access policy" },
    { label: "No role", value: view.stats.noRole, hint: "cannot use any section" },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" aria-label="Access summary">
      {cards.map((c) => (
        <Card key={c.label} className="space-y-1">
          <p className="text-xs font-medium uppercase text-muted">{c.label}</p>
          <p className="text-2xl font-semibold" data-stat={c.label}>
            {c.value}
          </p>
          <p className="text-xs text-muted">{c.hint}</p>
        </Card>
      ))}
    </div>
  );
}

function ruleText(r: PolicyRule, centers: { id: string; name: string }[]): string {
  const parts: string[] = [r.action];
  if (r.criteria?.centerId)
    parts.push(
      `at ${r.criteria.centerId.map((id) => centers.find((c) => c.id === id)?.name ?? "unknown center").join(", ")}`,
    );
  if (r.criteria?.sessionRole) parts.push(`as ${r.criteria.sessionRole.join(" or ")}`);
  if (r.readonlyFields?.length)
    parts.push(`read-only: ${r.readonlyFields.map((f) => READONLY_LABEL[f]).join(", ")}`);
  return parts.join(" · ");
}

function PolicyTable({
  ctx,
  view,
  onEdit,
}: {
  ctx: IiosGrantedContext;
  view: AccessAdminView;
  onEdit: (p: AccessPolicy) => void;
}) {
  const act = useAccessAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  if (view.policies.length === 0) return <EmptyState title="No access policies yet" />;
  return (
    <div className="space-y-2">
      {view.policies.map((p) => (
        <div key={p.id} data-policy={p.name}>
          <Card className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{p.name}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${p.status === "active" ? "border-brand text-brand" : "border-border text-muted"}`}
                >
                  {p.status === "active" ? "Active" : "Retired"}
                </span>
                <span className="text-xs text-muted">
                  {p.rules.length} {p.rules.length === 1 ? "rule" : "rules"} · v{p.version} ·
                  updated {formatCenterDateTime(p.updatedAt)} · used by {p.inUse}
                </span>
                {p.restrictsYou ? (
                  <span className="text-xs text-muted">· restricts you</span>
                ) : null}
              </p>
              {p.status === "active" ? (
                <span className="flex gap-2">
                  <Button variant="ghost" onClick={() => onEdit(p)} disabled={p.restrictsYou}>
                    Edit
                  </Button>
                  {confirm === p.id ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setConfirm(null);
                        act.mutate(() => iiosPolicyAdmin.retirePolicy(ctx, p.id, p.version));
                      }}
                    >
                      Yes, retire
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setConfirm(p.id)}
                      disabled={p.restrictsYou}
                      aria-label={`Retire ${p.name}`}
                    >
                      Retire
                    </Button>
                  )}
                </span>
              ) : null}
            </div>
            {p.description ? <p className="text-sm text-muted">{p.description}</p> : null}
            <ul className="list-disc pl-5 text-sm">
              {p.rules.map((r, i) => (
                <li key={i}>
                  <code className="text-xs">{ruleText(r, view.centers)}</code>
                </li>
              ))}
            </ul>
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">History ({p.history.length})</summary>
              <ul className="mt-1 space-y-1">
                {p.history.map((h) => (
                  <li key={h.version}>
                    v{h.version} · {h.change} by {h.changedBy} · {formatCenterDateTime(h.changedAt)}{" "}
                    · {h.rules.length} {h.rules.length === 1 ? "rule" : "rules"}
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        </div>
      ))}
      <Refusal result={act.data} />
    </div>
  );
}

function PolicyEditor({
  ctx,
  view,
  policy,
  onDone,
}: {
  ctx: IiosGrantedContext;
  view: AccessAdminView;
  policy: AccessPolicy | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(policy?.name ?? "");
  const [description, setDescription] = useState(policy?.description ?? "");
  const [rules, setRules] = useState<PolicyRule[]>(
    policy ? structuredClone(policy.rules) : [{ action: "schedule:manage" }],
  );
  const save = useMutation({
    mutationFn: () =>
      policy
        ? iiosPolicyAdmin.revisePolicy(ctx, policy.id, policy.version, { description, rules })
        : iiosPolicyAdmin.createPolicy(ctx, { name, description, rules }),
    onSuccess: async (r) => {
      if (!r.ok) return;
      await refreshLearningState(qc);
      onDone();
    },
  });
  const setRule = (i: number, r: PolicyRule) =>
    setRules((list) => list.map((x, j) => (j === i ? r : x)));
  const field = "rounded-ogc border border-border bg-surface p-1.5 text-sm";

  return (
    <section aria-label={policy ? `Edit ${policy.name}` : "New policy"}>
      <Card className="space-y-3">
        <h3 className="font-medium">
          {policy ? `Edit “${policy.name}” (v${policy.version})` : "New policy"}
        </h3>
        {policy ? null : (
          <label className="block text-sm">
            <span className="block text-xs text-muted">Name (3–100 characters, unique)</span>
            <input
              aria-label="Policy name"
              className={`${field} w-full`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
        )}
        <label className="block text-sm">
          <span className="block text-xs text-muted">Description (optional)</span>
          <input
            aria-label="Policy description"
            className={`${field} w-full`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <p className="text-xs text-muted">
          A member with this policy may do an action only if a rule below allows it and every
          condition matches. Anything not listed is not allowed.
        </p>
        <ol className="space-y-2">
          {rules.map((r, i) => (
            <RuleEditor
              key={i}
              index={i}
              rule={r}
              centers={view.centers}
              onChange={(x) => setRule(i, x)}
              onRemove={
                rules.length > 1 ? () => setRules((l) => l.filter((_, j) => j !== i)) : null
              }
            />
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            onClick={() => setRules((l) => [...l, { action: "makeup:manage" }])}
          >
            + Add rule
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {policy ? "Save new version" : "Create policy"}
          </Button>
          <Button variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
        <Refusal result={save.data} />
      </Card>
    </section>
  );
}

function toggle<T>(list: T[] | undefined, x: T): T[] {
  const l = list ?? [];
  return l.includes(x) ? l.filter((y) => y !== x) : [...l, x];
}

function RuleEditor({
  index,
  rule,
  centers,
  onChange,
  onRemove,
}: {
  index: number;
  rule: PolicyRule;
  centers: { id: string; name: string }[];
  onChange: (r: PolicyRule) => void;
  onRemove: (() => void) | null;
}) {
  const entry = POLICY_CATALOG.find((c) => c.action === rule.action)!;
  const label = `Rule ${index + 1}`;
  const setCriteria = (key: "centerId" | "sessionRole", values: string[]) => {
    const c = { ...(rule.criteria ?? {}) } as Record<string, string[]>;
    if (values.length) c[key] = values;
    else delete c[key];
    onChange({
      ...rule,
      criteria: Object.keys(c).length ? (c as PolicyRule["criteria"]) : undefined,
    });
  };
  return (
    <li className="space-y-2 rounded-ogc border border-border p-2 text-sm" aria-label={label}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">{label}</span>
        <select
          aria-label={`${label}: action`}
          className="rounded-ogc border border-border bg-surface p-1.5"
          value={rule.action}
          onChange={(e) => onChange({ action: e.target.value as PolicyAction })}
        >
          {POLICY_CATALOG.map((c) => (
            <option key={c.action} value={c.action}>
              {c.action}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{entry.description}</span>
        {onRemove ? (
          <Button variant="ghost" onClick={onRemove} aria-label={`Remove ${label}`}>
            Remove
          </Button>
        ) : null}
      </div>
      {entry.criteria.includes("centerId") ? (
        <fieldset className="flex flex-wrap gap-3">
          <legend className="text-xs text-muted">
            {CRITERION_LABEL.centerId} (none ticked = every center)
          </legend>
          {centers.map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                aria-label={`${label}: center ${c.name}`}
                checked={rule.criteria?.centerId?.includes(c.id) ?? false}
                onChange={() => setCriteria("centerId", toggle(rule.criteria?.centerId, c.id))}
              />
              {c.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      {entry.criteria.includes("sessionRole") ? (
        <fieldset className="flex flex-wrap gap-3">
          <legend className="text-xs text-muted">
            {CRITERION_LABEL.sessionRole} (none ticked = either)
          </legend>
          {(["owner", "substitute"] as SessionRole[]).map((r) => (
            <label key={r} className="flex items-center gap-1">
              <input
                type="checkbox"
                aria-label={`${label}: as ${r}`}
                checked={rule.criteria?.sessionRole?.includes(r) ?? false}
                onChange={() => setCriteria("sessionRole", toggle(rule.criteria?.sessionRole, r))}
              />
              {r === "owner" ? "class teacher" : "substitute"}
            </label>
          ))}
        </fieldset>
      ) : null}
      {entry.readonlyFields.length ? (
        <fieldset className="flex flex-wrap gap-3">
          <legend className="text-xs text-muted">read-only (cannot change)</legend>
          {entry.readonlyFields.map((f: ReadonlyField) => (
            <label key={f} className="flex items-center gap-1">
              <input
                type="checkbox"
                aria-label={`${label}: read-only ${READONLY_LABEL[f]}`}
                checked={rule.readonlyFields?.includes(f) ?? false}
                onChange={() => {
                  const next = toggle(rule.readonlyFields, f);
                  onChange({ ...rule, readonlyFields: next.length ? next : undefined });
                }}
              />
              {READONLY_LABEL[f]}
            </label>
          ))}
        </fieldset>
      ) : null}
    </li>
  );
}

function Members({ ctx, view }: { ctx: IiosGrantedContext; view: AccessAdminView }) {
  const act = useAccessAction();
  const active = view.policies.filter((p) => p.status === "active");
  return (
    <section aria-label="Members" className="space-y-3">
      <h2 className="text-xl font-medium">Members</h2>
      <p className="text-xs text-muted">
        From the organization (read-only). Attach a policy to narrow a member’s access.
      </p>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="p-2 font-medium">Member</th>
              <th className="p-2 font-medium">Role</th>
              <th className="p-2 font-medium">Access policy</th>
            </tr>
          </thead>
          <tbody>
            {view.memberships.map((m) => (
              <tr key={m.principalId} className="border-b border-border last:border-0">
                <td className="p-2">{m.displayName}</td>
                <td className="p-2">
                  {m.role ? ROLE_LABEL[m.role] : <span className="text-danger">No role</span>}
                </td>
                <td className="p-2">
                  {m.isYou ? (
                    <span className="text-muted">
                      {m.policyName ?? "— No restriction —"} (you — another Org Admin must change
                      this)
                    </span>
                  ) : m.canHavePolicy ? (
                    <select
                      aria-label={`Access policy for ${m.displayName}`}
                      className="rounded-ogc border border-border bg-surface p-1"
                      value={m.policyId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value || null; // read now, before the re-render
                        act.mutate(() => iiosPolicyAdmin.attachPolicy(ctx, m.principalId, id));
                      }}
                    >
                      <option value="">— No restriction —</option>
                      {active.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-muted">— not applicable —</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Refusal result={act.data} />
    </section>
  );
}

function Catalog() {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer font-medium">Action catalog (closed list)</summary>
      <Card className="mt-2 overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="p-2 font-medium">action</th>
              <th className="p-2 font-medium">description</th>
              <th className="p-2 font-medium">role</th>
              <th className="p-2 font-medium">conditions</th>
              <th className="p-2 font-medium">read-only fields</th>
            </tr>
          </thead>
          <tbody>
            {POLICY_CATALOG.map((c) => (
              <tr key={c.action} className="border-b border-border last:border-0">
                <td className="p-2">
                  <code>{c.action}</code>
                </td>
                <td className="p-2">{c.description}</td>
                <td className="p-2">{c.roles.join(", ")}</td>
                <td className="p-2">
                  {c.criteria.map((k) => CRITERION_LABEL[k]).join(", ") || "—"}
                </td>
                <td className="p-2">
                  {c.readonlyFields.map((f) => READONLY_LABEL[f]).join(", ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </details>
  );
}
