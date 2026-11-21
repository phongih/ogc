/*
 * Decision Engine (staff) — Observe → Detect → Decide → Act, as in EduOS. Owner decisions
 * 21/11: actions are limited to a log entry, an in-app notification (teacher / staff) and the
 * existing "Learners needing support" queue; staff enable / pause rules and tune thresholds,
 * priority, cooldown and actions; no free-form rules yet.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Rule, RuleAction, RuleCategory, RuleUpdate } from "@ogc/contracts";
import { QUEUE_KINDS, RULE_PARAMS } from "@ogc/contracts";
import { decisionEngine } from "../../lib/api";
import { useSession } from "../../app/session";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDateTime } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";

const TABS = ["Rules", "Events", "Action Log", "Job Status"] as const;
type Tab = (typeof TABS)[number];
const CATEGORY: Record<RuleCategory, string> = {
  learning: "Learning",
  attendance: "Attendance & make-up",
  operations: "Operations",
  engagement: "Engagement",
};
const ACTION: Record<RuleAction, string> = {
  log_only: "log only",
  notify_teacher: "notify teacher",
  notify_staff: "notify staff",
  support_queue: "learners needing support",
};

export function DecisionEnginePage() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  const [tab, setTab] = useState<Tab>("Rules");
  const rules = useQuery({
    queryKey: ["engine-rules", viewer],
    queryFn: () => decisionEngine.listRules(viewer),
    enabled: !!viewer,
  });
  if (rules.isLoading) return <Spinner label="Loading the Decision Engine" />;
  if (rules.isError)
    return (
      <ErrorState message="Could not load the Decision Engine." onRetry={() => rules.refetch()} />
    );
  if (!rules.data) return <EmptyState title="The Decision Engine is for center staff" />;
  return (
    <section className="space-y-4">
      <PageHeader
        title="Decision Engine"
        subtitle="Observe → Detect → Decide → Act · synthetic demo"
      />
      <p className="text-xs text-muted">
        The engine only logs, notifies teachers / staff in the app, and lists learners in “Learners
        needing support”. It never assigns work, changes scores or moves lessons — people decide.
      </p>
      <AccessBanner />
      <div
        role="tablist"
        aria-label="Decision Engine"
        className="flex gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`px-3 py-2 text-sm ${tab === t ? "border-b-2 border-brand font-medium text-brand" : "text-muted"}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Rules" ? <RulesTab viewer={viewer} rules={rules.data} /> : null}
      {tab === "Events" ? <EventsTab viewer={viewer} /> : null}
      {tab === "Action Log" ? <ActionsTab viewer={viewer} /> : null}
      {tab === "Job Status" ? <JobTab viewer={viewer} /> : null}
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Center operations
      </Link>
    </section>
  );
}

function RulesTab({ viewer, rules }: { viewer: string; rules: Rule[] }) {
  const me = useMyAccess();
  const canManage = me.data?.allowed["engine:manage"] ?? true;
  const actionsLocked = !!me.data?.readonly["engine:manage"]?.includes("actions");
  const cats = [...new Set(rules.map((r) => r.category))];
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        {rules.length} rules · {rules.filter((r) => r.enabled).length} active
      </p>
      {cats.map((c) => (
        <section key={c} aria-label={CATEGORY[c]} className="space-y-2">
          <h2 className="text-lg font-medium">{CATEGORY[c]}</h2>
          {rules
            .filter((r) => r.category === c)
            .map((r) => (
              <RuleCard
                key={r.id}
                viewer={viewer}
                rule={r}
                canManage={canManage}
                actionsLocked={actionsLocked}
              />
            ))}
        </section>
      ))}
    </div>
  );
}

function RuleCard({
  viewer,
  rule,
  canManage,
  actionsLocked,
}: {
  viewer: string;
  rule: Rule;
  canManage: boolean;
  actionsLocked: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Required<RuleUpdate>>({
    enabled: rule.enabled,
    priority: rule.priority,
    cooldownMin: rule.cooldownMin,
    params: { ...rule.params },
    actions: [...rule.actions],
  });
  const save = useMutation({
    mutationFn: (patch: RuleUpdate) => decisionEngine.updateRule(viewer, rule.id, patch),
    onSuccess: () => refreshLearningState(qc),
  });
  const dirty =
    draft.priority !== rule.priority ||
    draft.cooldownMin !== rule.cooldownMin ||
    JSON.stringify(draft.params) !== JSON.stringify(rule.params) ||
    JSON.stringify([...draft.actions].sort()) !== JSON.stringify([...rule.actions].sort());
  const allowed = (Object.keys(ACTION) as RuleAction[]).filter(
    (a) => a !== "support_queue" || QUEUE_KINDS.includes(rule.kind),
  );
  const input = "w-20 rounded-ogc border border-border bg-surface p-1 text-sm";

  return (
    <Card className={`space-y-2 ${rule.enabled ? "border-l-4 border-l-brand" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2" data-rule={rule.kind}>
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{rule.name}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${rule.enabled ? "border-brand text-brand" : "border-border text-muted"}`}
          >
            {rule.enabled ? "Active" : "Inactive"}
          </span>
          <code className="text-xs text-muted">{rule.kind}</code>
          <span className="text-xs text-muted">
            {rule.priority} · cooldown {rule.cooldownMin}m
          </span>
        </p>
        <Button
          variant="ghost"
          disabled={!canManage}
          onClick={() => save.mutate({ enabled: !rule.enabled })}
          aria-label={`${rule.enabled ? "Pause" : "Enable"} ${rule.name}`}
        >
          {rule.enabled ? "Pause" : "Enable"}
        </Button>
      </div>
      <p className="text-sm text-muted">{rule.description}</p>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {Object.entries(RULE_PARAMS[rule.kind]).map(([k, spec]) => (
          <label key={k}>
            <span className="block text-xs text-muted">{spec.label}</span>
            <input
              aria-label={`${rule.name}: ${spec.label}`}
              type="number"
              min={spec.min}
              max={spec.max}
              className={input}
              value={draft.params[k]}
              onChange={(e) =>
                setDraft((d) => ({ ...d, params: { ...d.params, [k]: Number(e.target.value) } }))
              }
            />
          </label>
        ))}
        <label>
          <span className="block text-xs text-muted">priority</span>
          <select
            aria-label={`${rule.name}: priority`}
            className="rounded-ogc border border-border bg-surface p-1 text-sm"
            value={draft.priority}
            onChange={(e) =>
              setDraft((d) => ({ ...d, priority: e.target.value as Rule["priority"] }))
            }
          >
            {["P1", "P2", "P3"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-muted">cooldown (min)</span>
          <input
            aria-label={`${rule.name}: cooldown`}
            type="number"
            className={input}
            value={draft.cooldownMin}
            onChange={(e) => setDraft((d) => ({ ...d, cooldownMin: Number(e.target.value) }))}
          />
        </label>
      </div>
      <div
        className="flex flex-wrap gap-3 text-sm"
        role="group"
        aria-label={`${rule.name}: actions`}
      >
        {allowed.map((a) => (
          <label key={a} className="flex items-center gap-1">
            <input
              type="checkbox"
              disabled={!canManage || actionsLocked}
              checked={draft.actions.includes(a)}
              onChange={() =>
                setDraft((d) => ({
                  ...d,
                  actions: d.actions.includes(a)
                    ? d.actions.filter((x) => x !== a)
                    : [...d.actions, a],
                }))
              }
            />
            → {ACTION[a]}
          </label>
        ))}
      </div>
      {actionsLocked ? (
        <p className="text-xs text-muted">Actions are read-only under your access policy.</p>
      ) : null}
      {dirty && canManage ? (
        <Button
          onClick={() =>
            save.mutate({
              priority: draft.priority,
              cooldownMin: draft.cooldownMin,
              params: draft.params,
              actions: draft.actions,
            })
          }
        >
          Save {rule.name}
        </Button>
      ) : null}
      {save.data && !save.data.ok ? (
        <p role="alert" className="text-sm text-danger">
          Not saved:{" "}
          {save.data.detail ??
            (save.data.reason === "access_policy"
              ? "your access policy does not allow this"
              : save.data.reason)}
        </p>
      ) : null}
    </Card>
  );
}

function EventsTab({ viewer }: { viewer: string }) {
  const q = useQuery({
    queryKey: ["engine-events", viewer],
    queryFn: () => decisionEngine.listEvents(viewer),
  });
  if (q.isLoading) return <Spinner label="Loading events" />;
  if (!q.data || q.data.length === 0)
    return <EmptyState title="No events yet" hint="Rules fire when their condition is true." />;
  return (
    <ul className="space-y-2" aria-label="Engine events">
      {q.data.map((e) => (
        <li key={e.id}>
          <Card className="text-sm">
            <p>
              <span className="font-medium">{e.priority}</span> · {e.ruleName} ·{" "}
              <span className="text-muted">{formatCenterDateTime(e.at)}</span>
            </p>
            <p>
              {e.subject.label} — {e.evidence}
            </p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function ActionsTab({ viewer }: { viewer: string }) {
  const q = useQuery({
    queryKey: ["engine-actions", viewer],
    queryFn: () => decisionEngine.listActions(viewer),
  });
  if (q.isLoading) return <Spinner label="Loading the action log" />;
  if (!q.data || q.data.length === 0) return <EmptyState title="No actions yet" />;
  return (
    <Card>
      <table className="w-full text-sm" aria-label="Action log">
        <thead>
          <tr className="text-left text-muted">
            <th className="pb-2 font-medium">When</th>
            <th className="pb-2 font-medium">Rule</th>
            <th className="pb-2 font-medium">Action</th>
            <th className="pb-2 font-medium">To</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((a) => (
            <tr key={a.id} className="border-t border-border">
              <td className="py-1.5">{formatCenterDateTime(a.at)}</td>
              <td className="py-1.5">{a.ruleName}</td>
              <td className="py-1.5">{ACTION[a.action]}</td>
              <td className="py-1.5">{a.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function JobTab({ viewer }: { viewer: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["engine-job", viewer],
    queryFn: () => decisionEngine.getJobStatus(viewer),
  });
  const run = useMutation({
    mutationFn: () => decisionEngine.runNow(viewer),
    onSuccess: () => refreshLearningState(qc),
  });
  const j = q.data;
  return (
    <Card className="space-y-2 text-sm">
      {j ? (
        <dl className="grid gap-2 sm:grid-cols-3" aria-label="Job status">
          <div>
            <dt className="text-xs text-muted">Last run</dt>
            <dd>{j.lastRunAt ? formatCenterDateTime(j.lastRunAt) : "not yet"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Runs</dt>
            <dd>{j.runs}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Last result</dt>
            <dd>
              {j.lastDetected} detected · {j.lastNewEvents} new events · {j.lastSkippedCooldown} in
              cooldown
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="text-xs text-muted">
        The job runs when a page asks and the last run is older than {j?.intervalSec ?? 60}s (mock —
        no background server).
      </p>
      <Button onClick={() => run.mutate()} disabled={run.isPending}>
        Run now
      </Button>
    </Card>
  );
}
