/*
 * Growth Engine (center staff) — owner decisions 22/11. Dashboard (K-factor, cohorts, LTV proxy,
 * campaigns, top referrers), the lead → placement → enrolled → confirmed funnel with anti-fraud
 * flags, and the program settings. Tuition credit is MOCK: nothing is charged or paid.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillingResult, GrowthResult, ReferralLead, ReferralProgram } from "@ogc/contracts";
import { growth } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import { FLAG_LABEL, STATUS_LABEL, vnd } from "./format";

const TABS = ["Dashboard", "Funnel", "Program"] as const;
type Tab = (typeof TABS)[number];

const REFUSAL: Record<string, string> = {
  not_staff: "Only center staff can do this.",
  not_found: "That lead no longer exists.",
  invalid_step: "Not at this step",
  flagged: "Cannot confirm — anti-fraud checks flagged",
  invalid: "Not valid",
  access_policy: "Your access policy does not allow this.",
  no_fee_line: "No approved fee line",
};

export function GrowthAdminPage() {
  const viewer = useViewer();
  const [tab, setTab] = useState<Tab>("Dashboard");
  const m = useQuery({
    queryKey: ["growth-metrics", viewer],
    queryFn: () => growth.getMetrics(viewer),
  });
  if (m.isLoading) return <Spinner label="Loading the Growth Engine" />;
  if (m.isError)
    return <ErrorState message="Could not load the Growth Engine." onRetry={() => m.refetch()} />;
  if (!m.data) return <EmptyState title="The Growth Engine is for center staff" />;
  return (
    <section className="space-y-4">
      <PageHeader title="Growth Engine" subtitle="Referral program · synthetic demo" />
      <p className="text-xs text-muted">
        A referral counts only when the new learner enrols and pays the first tuition and staff
        confirm it. Tuition credit is mock — nothing is charged or paid.
      </p>
      <AccessBanner />
      <div role="tablist" aria-label="Growth Engine" className="flex gap-1 border-b border-border">
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
      {tab === "Dashboard" ? <Dashboard /> : null}
      {tab === "Funnel" ? <Funnel /> : null}
      {tab === "Program" ? <Program /> : null}
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Center operations
      </Link>
    </section>
  );
}

function Dashboard() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["growth-metrics", viewer],
    queryFn: () => growth.getMetrics(viewer),
  });
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Confirmed referrals"
          value={d.confirmed}
          hint={`${d.confirmedThisMonth} this month`}
        />
        <StatTile
          label="Waiting for confirmation"
          value={d.pendingRewards}
          hint="enrolled + paid"
        />
        <StatTile
          label="K-factor"
          value={<span data-testid="k-factor">{d.kFactor.toFixed(2)}</span>}
          hint={`${d.invitesPerReferrer.toFixed(2)} leads per referrer × ${d.conversionPct ?? 0}% conversion`}
        />
        <StatTile label="Credit issued (mock)" value={vnd(d.walletIssuedVnd)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Referrers" value={d.referrers} hint={`${d.activeReferrers} active`} />
        <StatTile label="Link clicks" value={d.clicks} />
        <StatTile label="Leads" value={d.leads} />
        <StatTile
          label="LTV uplift (proxy)"
          value={
            d.ltvUpliftPct === null ? "—" : `${d.ltvUpliftPct > 0 ? "+" : ""}${d.ltvUpliftPct}%`
          }
          hint={
            d.ltvUpliftPct === null
              ? "needs confirmed referrals and a fee schedule (center wizard)"
              : "first payment of referred learners vs list price"
          }
        />
      </div>
      <Card>
        <h2 className="mb-2 font-medium">Cohorts (by month of the lead)</h2>
        {d.cohorts.length === 0 ? (
          <p className="text-sm text-muted">No leads yet.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Cohorts">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1">Month</th>
                <th>Leads</th>
                <th>Confirmed</th>
                <th>Conversion</th>
              </tr>
            </thead>
            <tbody>
              {d.cohorts.map((c) => (
                <tr key={c.month}>
                  <td className="py-1">{c.month}</td>
                  <td>{c.leads}</td>
                  <td>{c.confirmed}</td>
                  <td>{c.conversionPct === null ? "—" : `${c.conversionPct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-medium">Campaigns</h2>
          <ul className="space-y-1 text-sm">
            {d.campaigns.map((c) => (
              <li key={c.id} className="flex justify-between">
                <span>
                  {c.name} {c.active ? "" : "(paused)"}
                </span>
                <span>
                  {c.leads} leads · {c.confirmed} confirmed
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-medium">Top referrers</h2>
          {d.topReferrers.length === 0 ? (
            <p className="text-sm text-muted">No referrals yet.</p>
          ) : (
            <ol className="space-y-1 text-sm" aria-label="Top referrers">
              {d.topReferrers.map((r) => (
                <li key={r.name} className="flex justify-between">
                  <span>{r.name}</span>
                  <span>
                    {r.confirmed}/{r.leads} · {vnd(r.rewardVnd)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function useGrowthAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<GrowthResult | BillingResult<object>>) => run(),
    onSuccess: () => refreshLearningState(qc),
  });
}

function Funnel() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["growth-leads", viewer],
    queryFn: () => growth.listLeads(viewer),
  });
  if (!q.data) return <Spinner label="Loading leads" />;
  if (q.data.length === 0)
    return (
      <EmptyState
        title="No leads yet"
        hint="Leads appear when someone uses a shared referral link."
      />
    );
  return (
    <ul className="space-y-2" aria-label="Referral leads">
      {q.data.map((l) => (
        <LeadCard key={l.id} lead={l} />
      ))}
    </ul>
  );
}

function LeadCard({ lead: l }: { lead: ReferralLead }) {
  const viewer = useViewer();
  const act = useGrowthAction();
  const me = useMyAccess();
  const can = me.data?.allowed["growth:manage"] ?? true;
  const [why, setWhy] = useState("");
  const label = l.learnerName;
  return (
    <li>
      <Card className="space-y-2">
        <div
          className="flex flex-wrap items-baseline justify-between gap-2"
          data-lead={l.learnerName}
        >
          <p>
            <span className="font-medium">{l.learnerName}</span>{" "}
            <span className="text-sm text-muted">
              · {l.courseCode} · {l.centerName} · referred by {l.referrerName} ·{" "}
              {formatCenterDate(l.createdAt)}
            </span>
          </p>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs">
            {STATUS_LABEL[l.status]}
          </span>
        </div>
        {l.flags.length ? (
          <p className="text-sm text-danger" role="note">
            Anti-fraud: {l.flags.map((f) => FLAG_LABEL[f]).join(" · ")}
          </p>
        ) : null}
        {l.status === "lead" || l.status === "placed" ? (
          <p className="text-sm">
            Admissions stage: <span className="font-medium">{l.stage}</span>
            {l.invoiceNo ? ` · first invoice ${l.invoiceNo} waiting for payment (Billing)` : ""}.
            Placement and the first invoice are handled in{" "}
            <Link className="text-brand underline" to="/app/operations/admissions">
              Admissions
            </Link>
            ; the reward is decided here once the first invoice is paid in full.
          </p>
        ) : null}
        {l.status === "enrolled" ? (
          <p className="text-sm">
            First invoice {l.invoiceNo} paid: {vnd(l.firstPaymentVnd ?? 0)}
          </p>
        ) : null}
        {l.status === "confirmed" ? (
          <p className="text-sm">
            First payment {vnd(l.firstPaymentVnd ?? 0)}
            {l.invoiceNo ? ` (${l.invoiceNo})` : ""} → credit {vnd(l.rewardVnd ?? 0)} to{" "}
            {l.referrerName}
          </p>
        ) : null}
        {l.status === "rejected" ? (
          <p className="text-sm text-muted">Reason: {l.rejectedReason}</p>
        ) : null}
        {can && l.status !== "confirmed" && l.status !== "rejected" ? (
          <div className="flex flex-wrap items-end gap-2 text-sm">
            {l.status === "enrolled" ? (
              <Button onClick={() => act.mutate(() => growth.confirm(viewer, l.id))}>
                Confirm reward · {label}
              </Button>
            ) : null}
            <input
              aria-label={`Reason not to count ${label}`}
              placeholder="Reason not to count"
              className="rounded-ogc border border-border bg-surface p-1"
              value={why}
              onChange={(e) => setWhy(e.target.value)}
            />
            <Button
              variant="ghost"
              onClick={() => act.mutate(() => growth.reject(viewer, l.id, why))}
            >
              Don&apos;t count · {label}
            </Button>
          </div>
        ) : null}
        {act.data && !act.data.ok ? (
          <p role="alert" className="text-sm text-danger">
            {REFUSAL[act.data.reason] ?? act.data.reason}
            {act.data.detail ? `: ${act.data.detail}` : ""}
          </p>
        ) : null}
      </Card>
    </li>
  );
}

function Program() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["growth-program", viewer],
    queryFn: () => growth.getProgram(viewer),
  });
  if (!q.data) return <Spinner label="Loading the program" />;
  return <ProgramForm key={JSON.stringify(q.data)} program={q.data} />;
}

function ProgramForm({ program }: { program: ReferralProgram }) {
  const viewer = useViewer();
  const act = useGrowthAction();
  const me = useMyAccess();
  const can = me.data?.allowed["growth:manage"] ?? true;
  const [d, setD] = useState<ReferralProgram>(structuredClone(program));
  const num = "w-32 rounded-ogc border border-border bg-surface p-1";
  return (
    <Card className="space-y-3 text-sm">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label="Program enabled"
          disabled={!can}
          checked={d.enabled}
          onChange={(e) => {
            const v = e.target.checked;
            setD((x) => ({ ...x, enabled: v }));
          }}
        />
        Referral program on
      </label>
      <label className="flex items-center gap-2">
        Reward
        <input
          type="number"
          aria-label="Reward percent"
          className={num}
          disabled={!can}
          value={d.rewardPct}
          onChange={(e) => {
            const v = Number(e.target.value);
            setD((x) => ({ ...x, rewardPct: v }));
          }}
        />
        % of the first tuition payment
      </label>
      <label className="flex items-center gap-2">
        Maximum
        <input
          type="number"
          aria-label="Reward cap"
          className={num}
          disabled={!can}
          value={d.capVnd}
          onChange={(e) => {
            const v = Number(e.target.value);
            setD((x) => ({ ...x, capVnd: v }));
          }}
        />
        VND per referral
      </label>
      {d.campaigns.map((c, i) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              aria-label={`${c.name}: active`}
              disabled={!can}
              checked={c.active}
              onChange={(e) => {
                const v = e.target.checked;
                setD((x) => {
                  const n = structuredClone(x);
                  n.campaigns[i].active = v;
                  return n;
                });
              }}
            />
            {c.name}
          </label>
          <label className="flex items-center gap-1">
            +
            <input
              type="number"
              aria-label={`${c.name}: bonus`}
              className="w-20 rounded-ogc border border-border bg-surface p-1"
              disabled={!can}
              value={c.bonusPct}
              onChange={(e) => {
                const v = Number(e.target.value);
                setD((x) => {
                  const n = structuredClone(x);
                  n.campaigns[i].bonusPct = v;
                  return n;
                });
              }}
            />
            % · link: <code>/join?ref=&lt;code&gt;&amp;c={c.id}</code>
          </label>
        </div>
      ))}
      {can ? (
        <Button onClick={() => act.mutate(() => growth.updateProgram(viewer, d))}>
          Save program
        </Button>
      ) : null}
      {act.data && !act.data.ok ? (
        <p role="alert" className="text-danger">
          {REFUSAL[act.data.reason] ?? act.data.reason}
          {act.data.detail ? `: ${act.data.detail}` : ""}
        </p>
      ) : act.data?.ok ? (
        <p role="status">Saved.</p>
      ) : null}
    </Card>
  );
}
