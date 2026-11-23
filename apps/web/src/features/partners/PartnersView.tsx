/*
 * Partner Commissions (owner decisions 22/11). Leads the organization hands to partner centers,
 * tiered commissions with rule versions, reconciliation, decision signals that only suggest, and
 * an append-only activity log. Staff record what partners report; an Org Admin activates rules
 * and approves entries — never their own step. A mock receivable: no money moves. SYNTHETIC.
 * Shared by the demo and the Platform (owner, 23/11) through `PartnersApiContext`.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  tierRuleIssue,
  type CommissionEntry,
  type CommissionStatus,
  type DecisionSignal,
  type Partner,
  type PartnersResult,
  type SignalRule,
  type TierRule,
  type TierRuleDraft,
} from "@ogc/contracts";
import { formatCenterDate, formatCenterDateTime } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { vnd } from "../growth/format";
import { Refused } from "./refused";
import { usePartnersApi } from "./partnersApi";
import { ImportReport, Settlements, Trends } from "./PartnersSlice2";

const TABS = [
  "Reconciliation",
  "Ledger",
  "Settlements",
  "Import report",
  "Trends",
  "Tiers & policy",
  "Activity",
] as const;
type Tab = (typeof TABS)[number];
const tabClass = (on: boolean) =>
  `px-3 py-2 text-sm ${on ? "border-b-2 border-brand font-medium text-brand" : "text-muted"}`;
export const STATUS_LABEL: Record<CommissionStatus, string> = {
  referred: "Referred",
  enrolled: "Enrolled (waiting)",
  approved: "Approved · awaiting payment",
  paid: "Paid",
  rejected: "Rejected",
};
const SIGNAL_LABEL: Record<SignalRule, string> = {
  near_next_tier: "Near the next tier",
  stale_referral: "Stale referral",
  high_rejection_rate: "High rejection rate",
  overdue_settlement: "Overdue settlement",
};
function useAction() {
  const api = usePartnersApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<PartnersResult>) => run(),
    onSuccess: () => api.onChanged(qc),
  });
}
export function PartnersView() {
  const api = usePartnersApi();
  const [tab, setTab] = useState<Tab>("Reconciliation");

  const o = useQuery({
    queryKey: [...api.key, "partners-overview"],
    queryFn: () => api.getOverview(),
  });
  if (o.isLoading) return <Spinner label="Loading partner commissions" />;
  if (o.isError)
    return <ErrorState message="Could not load partner commissions." onRetry={() => o.refetch()} />;
  if (!o.data) return <EmptyState title="Partner commissions are for center staff with access" />;
  return (
    <section className="space-y-4">
      <PageHeader title="Partner commissions" subtitle={api.subtitle} />
      <p className="text-xs text-muted">
        A lead goes to a partner from Admissions (&quot;Refer to partner&quot;); the partner only
        gets a reference code, a short name and the course. Partners are suggested by fit for the
        learner, never by commission. Staff record what partners report; an Org Admin approves.
        Signals only suggest. Mock receivable — nothing is invoiced or paid here.
      </p>
      {api.Banner ? <api.Banner /> : null}
      <div
        role="tablist"
        aria-label="Partner commissions"
        className="flex gap-1 border-b border-border"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tabClass(tab === t)}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Reconciliation" ? <Reconciliation onOpen={setTab} /> : null}
      {tab === "Ledger" ? <Ledger isAdmin={o.data.isOrgAdmin} /> : null}
      {tab === "Settlements" ? <Settlements isAdmin={o.data.isOrgAdmin} /> : null}
      {tab === "Import report" ? <ImportReport /> : null}
      {tab === "Trends" ? <Trends /> : null}
      {tab === "Tiers & policy" ? <Tiers isAdmin={o.data.isOrgAdmin} /> : null}
      {tab === "Activity" ? <Activity /> : null}
      {api.back ? (
        <Link to={api.back.to} className="inline-block text-sm text-brand">
          {api.back.label}
        </Link>
      ) : null}
    </section>
  );
}

// ── Reconciliation ──────────────────────────────────────────────────────────────────────────

function Reconciliation({ onOpen }: { onOpen: (t: Tab) => void }) {
  const api = usePartnersApi();
  const o = useQuery({
    queryKey: [...api.key, "partners-overview"],
    queryFn: () => api.getOverview(),
  });
  const d = o.data;
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Received"
          value={<span data-testid="kpi-received">{vnd(d.kpis.receivedVnd)}</span>}
          hint="paid by partners"
        />
        <StatTile
          label="Awaiting payment"
          value={<span data-testid="kpi-awaiting">{vnd(d.kpis.awaitingPaymentVnd)}</span>}
          hint="approved, not paid yet"
        />
        <StatTile
          label="Awaiting enrolment"
          value={d.kpis.awaitingEnrolment}
          hint="referred, partner has not confirmed"
        />
        <StatTile
          label="Next-tier uplift"
          value={vnd(d.kpis.nextTierUpliftVnd)}
          hint="if partners one enrolment short reach their next tier"
        />
      </div>
      <Signals signals={d.signals} onOpen={onOpen} />
      <Card>
        <h2 className="mb-2 font-semibold">By partner</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Partners summary">
            <thead>
              <tr className="text-left text-muted">
                {[
                  "Partner",
                  "Referred",
                  "Enrolled",
                  "Approved",
                  "Paid",
                  "Rejected",
                  "This cycle",
                  "Received",
                  "Awaiting",
                  "Overdue",
                ].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.partners.map((p) => (
                <tr key={p.partnerId} className="border-t border-border align-top">
                  <th scope="row" className="py-1 pr-3 text-left font-medium">
                    {p.partnerName}
                  </th>
                  <td className="py-1 pr-3">{p.referred}</td>
                  <td className="py-1 pr-3">{p.enrolled}</td>
                  <td className="py-1 pr-3">{p.approved}</td>
                  <td className="py-1 pr-3">{p.paid}</td>
                  <td className="py-1 pr-3">{p.rejected}</td>
                  <td className="py-1 pr-3">
                    {p.cycleCount} enrolled
                    {p.currentTierAmountVnd !== null ? ` · ${vnd(p.currentTierAmountVnd)}` : ""}
                    {p.nextTier ? (
                      <div className="text-xs text-muted">
                        next: from no. {p.nextTier.at} · {vnd(p.nextTier.amountVnd)}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-1 pr-3">{vnd(p.receivedVnd)}</td>
                  <td className="py-1 pr-3">{vnd(p.awaitingPaymentVnd)}</td>
                  <td className={`py-1 pr-3 ${p.overdueVnd > 0 ? "text-danger" : ""}`}>
                    {vnd(p.overdueVnd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Signals({ signals, onOpen }: { signals: DecisionSignal[]; onOpen: (t: Tab) => void }) {
  const open = signals.filter((s) => s.state === "open");
  const done = signals.filter((s) => s.state !== "open");
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Decision signals ({open.length})</h2>
      <p className="mb-2 text-xs text-muted">
        Suggestions only — nothing changes until a person acts. Every choice is logged.
      </p>
      {open.length === 0 ? <p className="text-sm text-muted">No open signals.</p> : null}
      <ul className="space-y-2" aria-label="Open signals">
        {open.map((s) => (
          <li key={s.id}>
            <SignalCard s={s} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      {done.length ? (
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted">Handled ({done.length})</summary>
          <ul className="mt-1 space-y-1">
            {done.map((s) => (
              <li key={s.id} className="text-muted">
                {SIGNAL_LABEL[s.rule]} · {s.partnerName} — {s.state}
                {s.note ? `: ${s.note}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function SignalCard({ s, onOpen }: { s: DecisionSignal; onOpen: (t: Tab) => void }) {
  const api = usePartnersApi();
  const act = useAction();
  const [note, setNote] = useState("");
  const target: Tab = "Ledger"; // every signal is about ledger entries
  return (
    <div className="rounded-ogc border border-border p-3" data-testid={`signal-${s.rule}`}>
      <p className="text-sm">
        <span className="font-medium">{SIGNAL_LABEL[s.rule]}</span> · {s.message}
      </p>
      <ul className="mt-1 list-disc pl-5 text-xs text-muted">
        {s.evidence.map((e, i) => (
          <li key={i}>{e}</li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <Button
          variant="ghost"
          onClick={() =>
            act.mutate(() => api.actOnSignal(s.id, "follow"), {
              onSuccess: (r) => r.ok && onOpen(target),
            })
          }
        >
          Follow · {SIGNAL_LABEL[s.rule]}
        </Button>
        <Button variant="ghost" onClick={() => act.mutate(() => api.actOnSignal(s.id, "snooze"))}>
          Snooze 7 days
        </Button>
        <input
          aria-label={`Why dismiss · ${SIGNAL_LABEL[s.rule]} · ${s.partnerName}`}
          placeholder="Why dismiss?"
          className="rounded-ogc border border-border bg-surface p-1"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          variant="ghost"
          onClick={() => act.mutate(() => api.actOnSignal(s.id, "dismiss", note))}
        >
          Dismiss
        </Button>
      </div>
      <Refused r={act.data} />
    </div>
  );
}

// ── Ledger ──────────────────────────────────────────────────────────────────────────────────

function Ledger({ isAdmin }: { isAdmin: boolean }) {
  const api = usePartnersApi();
  const q = useQuery({
    queryKey: [...api.key, "partners-entries"],
    queryFn: () => api.listEntries(),
  });
  const [partner, setPartner] = useState("all");
  const [status, setStatus] = useState<"all" | CommissionStatus>("all");
  const list = q.data ?? [];
  const names = [...new Map(list.map((e) => [e.partnerId, e.partnerName])).entries()];
  const shown = list.filter(
    (e) =>
      (partner === "all" || e.partnerId === partner) && (status === "all" || e.status === status),
  );
  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-end gap-2 text-sm">
        <h2 className="mr-auto font-semibold">Commission ledger</h2>
        <label>
          <span className="block text-xs text-muted">Partner</span>
          <select
            aria-label="Filter by partner"
            className="rounded-ogc border border-border bg-surface p-1"
            value={partner}
            onChange={(e) => setPartner(e.target.value)}
          >
            <option value="all">All partners</option>
            {names.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="block text-xs text-muted">Status</span>
          <select
            aria-label="Filter by status"
            className="rounded-ogc border border-border bg-surface p-1"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="all">All</option>
            {(Object.keys(STATUS_LABEL) as CommissionStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul className="space-y-2" aria-label="Ledger entries">
        {shown.map((e) => (
          <li key={e.id}>
            <EntryRow e={e} isAdmin={isAdmin} />
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <p className="text-sm text-muted">No entries.</p> : null}
    </Card>
  );
}

function EntryRow({ e, isAdmin }: { e: CommissionEntry; isAdmin: boolean }) {
  const api = usePartnersApi();
  const act = useAction();
  const [reason, setReason] = useState("");
  const now = Date.now();
  const expired = e.status === "referred" && Date.parse(e.expiresAt) < now;
  const overdue = e.status === "approved" && e.dueDate && Date.parse(e.dueDate) < now;
  return (
    <div
      className="rounded-ogc border border-border p-3 text-sm"
      data-testid={`entry-${e.learnerDisplayName}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{e.learnerDisplayName}</span>
        <span className="text-muted">
          {e.leadRefCode} · {e.courseCode} → {e.partnerName}
        </span>
        <span className={`ml-auto ${e.status === "rejected" || overdue ? "text-danger" : ""}`}>
          {STATUS_LABEL[e.status]}
          {overdue ? " · overdue" : ""}
          {expired ? " · attribution window ended" : ""}
        </span>
      </div>
      <p className="text-xs text-muted">
        Referred {formatCenterDate(e.referredAt)} · window ends {formatCenterDate(e.expiresAt)}
        {e.enrolledAt ? ` · enrolled ${formatCenterDate(e.enrolledAt)} (${e.cycleLabel})` : ""}
        {e.appliedRuleVersion ? ` · rule v${e.appliedRuleVersion}, tier ${e.appliedTierIndex}` : ""}
        {e.amountVnd !== null
          ? ` · ${vnd(e.amountVnd)}${e.provisional ? " (provisional until the cycle ends)" : ""}`
          : ""}
        {e.approvableFrom ? ` · can be approved from ${formatCenterDate(e.approvableFrom)}` : ""}
        {e.dueDate ? ` · due ${formatCenterDate(e.dueDate)}` : ""}
        {e.settledBatchId ? ` · batch ${e.settledBatchId}` : ""}
        {e.rejectReason ? ` · reason: ${e.rejectReason}` : ""} · last by {e.updatedBy}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {e.status === "referred" ? (
          <Button variant="ghost" onClick={() => act.mutate(() => api.markEnrolled(e.id))}>
            Partner confirmed enrolment · {e.learnerDisplayName}
          </Button>
        ) : null}
        {e.status === "enrolled" && isAdmin ? (
          <Button onClick={() => act.mutate(() => api.approve(e.id))}>
            Approve · {e.learnerDisplayName}
          </Button>
        ) : null}
        {e.status === "referred" || e.status === "enrolled" ? (
          <>
            <input
              aria-label={`Reject reason · ${e.learnerDisplayName}`}
              placeholder="Why rejected?"
              className="rounded-ogc border border-border bg-surface p-1"
              value={reason}
              onChange={(x) => setReason(x.target.value)}
            />
            <Button variant="ghost" onClick={() => act.mutate(() => api.reject(e.id, reason))}>
              Reject · {e.learnerDisplayName}
            </Button>
          </>
        ) : null}
        {e.status === "approved" ? (
          <span className="text-xs text-muted">
            {e.batchId
              ? `In batch ${e.batchId} — paid with the whole batch (Settlements)`
              : "Not in a batch yet — draft one under Settlements"}
          </span>
        ) : null}
      </div>
      <Refused r={act.data} />
    </div>
  );
}

// ── Tiers & policy ──────────────────────────────────────────────────────────────────────────

const ruleText = (r: TierRule) =>
  `${r.mode === "progressive" ? "Progressive" : "Retroactive (whole cycle)"} · ${r.cycle} · ${r.tiers
    .map(
      (t, i, all) =>
        `${t.minCount}${all[i + 1] ? `–${all[i + 1].minCount - 1}` : "+"}: ${vnd(t.amountVnd)}`,
    )
    .join(" · ")} · attribution ${r.attributionWindowDays} d · clawback ${r.clawbackWindowDays} d`;

function Tiers({ isAdmin }: { isAdmin: boolean }) {
  const api = usePartnersApi();
  const q = useQuery({
    queryKey: [...api.key, "partners-list"],
    queryFn: () => api.listPartners(),
  });
  return (
    <div className="space-y-3">
      {(q.data ?? []).map((p) => (
        <PartnerCard key={p.id} p={p} isAdmin={isAdmin} />
      ))}
    </div>
  );
}

function PartnerCard({ p, isAdmin }: { p: Partner; isAdmin: boolean }) {
  const api = usePartnersApi();
  const act = useAction();
  const [draft, setDraft] = useState<TierRuleDraft | null>(null);
  const issue = draft ? tierRuleIssue(draft) : null;
  return (
    <Card>
      <section aria-label={`Partner ${p.name}`} className="space-y-2 text-sm">
        <h2 className="font-semibold">{p.name}</h2>
        <p className="text-xs text-muted">
          Teaches {p.courses.join(", ")} · near {p.nearCenters.join(", ") || "—"} · {p.retentionPct}
          % still learning after 3 months · pays within {p.settlementDays} days · data: confidential
        </p>
        {p.rule ? (
          <p data-testid={`rule-${p.id}`}>
            <span className="font-medium">Active v{p.rule.version}:</span> {ruleText(p.rule)}
          </p>
        ) : (
          <p className="text-danger">No active rule.</p>
        )}
        {p.pendingRule ? (
          <div className="rounded-ogc border border-brand p-2">
            <p>
              <span className="font-medium">
                Waiting for an Org Admin — v{p.pendingRule.version}:
              </span>{" "}
              {ruleText(p.pendingRule)}
            </p>
            <p className="text-xs text-muted">
              Proposed by {p.pendingRule.proposedBy}
              {p.pendingRule.mine ? " (you — another Org Admin decides)" : ""}. Applies only to
              enrolments recorded after it is activated.
            </p>
            {isAdmin && !p.pendingRule.mine ? (
              <div className="mt-1 flex gap-2">
                <Button
                  onClick={() => act.mutate(() => api.decideRule(p.pendingRule!.id, "activate"))}
                >
                  Activate v{p.pendingRule.version} · {p.name}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => act.mutate(() => api.decideRule(p.pendingRule!.id, "reject"))}
                >
                  Reject v{p.pendingRule.version}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
        {!p.pendingRule && !draft && p.rule ? (
          <Button
            variant="ghost"
            onClick={() =>
              setDraft({
                cycle: p.rule!.cycle,
                mode: p.rule!.mode,
                tiers: p.rule!.tiers.map((t) => ({ ...t })),
                attributionWindowDays: p.rule!.attributionWindowDays,
                clawbackWindowDays: p.rule!.clawbackWindowDays,
              })
            }
          >
            Propose a new version · {p.name}
          </Button>
        ) : null}
        {draft ? (
          <div className="space-y-2 rounded-ogc border border-border p-2">
            <div className="flex flex-wrap gap-2">
              <label>
                <span className="block text-xs text-muted">Cycle</span>
                <select
                  aria-label={`Cycle · ${p.name}`}
                  className="rounded-ogc border border-border bg-surface p-1"
                  value={draft.cycle}
                  onChange={(e) =>
                    setDraft({ ...draft, cycle: e.target.value as TierRuleDraft["cycle"] })
                  }
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </label>
              <label>
                <span className="block text-xs text-muted">Mode</span>
                <select
                  aria-label={`Mode · ${p.name}`}
                  className="rounded-ogc border border-border bg-surface p-1"
                  value={draft.mode}
                  onChange={(e) =>
                    setDraft({ ...draft, mode: e.target.value as TierRuleDraft["mode"] })
                  }
                >
                  <option value="progressive">Progressive (each enrolment at its tier)</option>
                  <option value="retroactive">Retroactive (whole cycle at the tier reached)</option>
                </select>
              </label>
              <NumberBox
                label={`Attribution days · ${p.name}`}
                value={draft.attributionWindowDays}
                onChange={(v) => setDraft({ ...draft, attributionWindowDays: v })}
              />
              <NumberBox
                label={`Clawback days · ${p.name}`}
                value={draft.clawbackWindowDays}
                onChange={(v) => setDraft({ ...draft, clawbackWindowDays: v })}
              />
            </div>
            <table className="text-sm" aria-label={`Tiers · ${p.name}`}>
              <tbody>
                {draft.tiers.map((t, i) => (
                  <tr key={i}>
                    <td className="pr-2">Tier {i + 1} from enrolment no.</td>
                    <td className="pr-2">
                      <NumberBox
                        label={`Tier ${i + 1} start · ${p.name}`}
                        value={t.minCount}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            tiers: draft.tiers.map((x, j) => (j === i ? { ...x, minCount: v } : x)),
                          })
                        }
                      />
                    </td>
                    <td className="pr-2">
                      <NumberBox
                        label={`Tier ${i + 1} amount · ${p.name}`}
                        value={t.amountVnd}
                        onChange={(v) =>
                          setDraft({
                            ...draft,
                            tiers: draft.tiers.map((x, j) =>
                              j === i ? { ...x, amountVnd: v } : x,
                            ),
                          })
                        }
                      />
                    </td>
                    <td>
                      {draft.tiers.length > 1 ? (
                        <button
                          type="button"
                          className="text-xs text-danger"
                          onClick={() =>
                            setDraft({ ...draft, tiers: draft.tiers.filter((_, j) => j !== i) })
                          }
                        >
                          remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="text-sm text-brand"
                onClick={() => {
                  const last = draft.tiers[draft.tiers.length - 1];
                  setDraft({
                    ...draft,
                    tiers: [
                      ...draft.tiers,
                      { minCount: last.minCount + 1, amountVnd: last.amountVnd },
                    ],
                  });
                }}
              >
                + tier
              </button>
              <Button
                disabled={!!issue}
                onClick={() =>
                  act.mutate(() => api.proposeRule(p.id, draft), {
                    onSuccess: (r) => r.ok && setDraft(null),
                  })
                }
              >
                Send for approval · {p.name}
              </Button>
              <button type="button" className="text-sm text-muted" onClick={() => setDraft(null)}>
                Cancel
              </button>
              {issue ? <span className="text-xs text-danger">{issue}</span> : null}
            </div>
          </div>
        ) : null}
        <Refused r={act.data} />
        <details>
          <summary className="cursor-pointer text-xs text-muted">
            Versions ({p.history.length})
          </summary>
          <ul className="mt-1 space-y-1 text-xs">
            {p.history.map((r) => (
              <li key={r.id}>
                v{r.version} · {r.status} · proposed by {r.proposedBy}{" "}
                {formatCenterDate(r.proposedAt)}
                {r.decidedBy
                  ? ` · decided by ${r.decidedBy} ${formatCenterDate(r.decidedAt!)}`
                  : ""}{" "}
                — {ruleText(r)}
              </li>
            ))}
          </ul>
        </details>
      </section>
    </Card>
  );
}

function NumberBox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label>
      <span className="sr-only">{label}</span>
      <input
        type="number"
        aria-label={label}
        className="w-28 rounded-ogc border border-border bg-surface p-1"
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) =>
          onChange(e.target.value.trim() === "" ? Number.NaN : Number(e.target.value))
        }
      />
    </label>
  );
}

// ── Activity ────────────────────────────────────────────────────────────────────────────────

function Activity() {
  const api = usePartnersApi();
  const q = useQuery({
    queryKey: [...api.key, "partners-activity"],
    queryFn: () => api.listActivity(),
  });
  const list = q.data ?? [];
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Activity (append-only)</h2>
      <p className="mb-2 text-xs text-muted">
        Every referral, status change, rule decision and signal choice — newest first. Entries are
        never edited.
      </p>
      {list.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet in this demo session.</p>
      ) : null}
      <ol className="space-y-1 text-sm" aria-label="Activity log">
        {list.map((a, i) => (
          <li key={i} className="border-t border-border pt-1 first:border-0">
            <span className="text-muted">
              {formatCenterDateTime(a.at)} · {a.by} ·
            </span>{" "}
            {a.action} — {a.subject}
            {a.detail ? <span className="text-muted"> ({a.detail})</span> : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
