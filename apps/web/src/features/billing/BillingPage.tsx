/*
 * Billing & payments for center staff (owner decisions 22/11; pattern from EduOS Billing).
 * Fee plans (staff propose, an Org Admin approves — never their own), invoices (generated once per
 * learner per fee line), recorded payments, receivables. SYNTHETIC: nothing is charged or paid.
 * The adapter decides every action; this page only reflects it.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BillingResult, FeeLine, FeeLineDraft, Invoice, PaymentMethod } from "@ogc/contracts";
import { billing } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import { centers } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { vnd } from "../growth/format";

const TABS = ["Fee plans", "Invoices", "Payments", "Receivables"] as const;
type Tab = (typeof TABS)[number];

export const INVOICE_STATUS: Record<Invoice["status"], string> = {
  issued: "Issued",
  partially_paid: "Partly paid",
  paid: "Paid",
  void: "Void",
};
const LINE_STATUS: Record<FeeLine["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  rejected: "Rejected",
  retired: "Retired",
};
const REFUSAL: Record<string, string> = {
  not_staff: "Only center staff can do this.",
  not_org_admin: "Only an Org Admin can decide fee lines.",
  own_proposal: "You proposed this line",
  not_found: "Not found.",
  invalid: "Not valid",
  invalid_step: "Not at this step",
  no_fee_line: "No approved fee line",
  access_policy: "Your access policy does not allow this.",
};
const METHOD: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  card: "Card",
};

function useBillingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<BillingResult<object>>) => run(),
    onSuccess: () => refreshLearningState(qc),
  });
}

function Refused({ r }: { r: BillingResult<object> | undefined }) {
  if (!r || r.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[r.reason] ?? r.reason}
      {r.detail ? `: ${r.detail}` : ""}
    </p>
  );
}

const tabClass = (on: boolean) =>
  `px-3 py-2 text-sm ${on ? "border-b-2 border-brand font-medium text-brand" : "text-muted"}`;

export function BillingPage() {
  const viewer = useViewer();
  const [tab, setTab] = useState<Tab>("Fee plans");
  const years = useQuery({
    queryKey: ["billing-years", viewer],
    queryFn: () => billing.years(viewer),
  });
  if (years.isLoading) return <Spinner label="Loading billing" />;
  if (years.isError)
    return <ErrorState message="Could not load billing." onRetry={() => years.refetch()} />;
  if (!years.data) return <EmptyState title="Billing is for center staff" />;
  return (
    <section className="space-y-4">
      <PageHeader
        title="Billing & payments"
        subtitle="Fee plans · invoices · receivables · synthetic demo"
      />
      <p className="text-xs text-muted">
        Demo only — nothing is charged, paid or invoiced for real. An overdue invoice never blocks
        learning or attendance; staff are told in Receivables and by the Decision Engine.
      </p>
      <AccessBanner />
      <div role="tablist" aria-label="Billing" className="flex gap-1 border-b border-border">
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
      {tab === "Fee plans" ? <FeePlans years={years.data} /> : null}
      {tab === "Invoices" ? <Invoices /> : null}
      {tab === "Payments" ? <Payments /> : null}
      {tab === "Receivables" ? <ReceivablesView /> : null}
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Center operations
      </Link>
    </section>
  );
}

// ── Fee plans ───────────────────────────────────────────────────────────────────────────────

function FeePlans({ years }: { years: string[] }) {
  const viewer = useViewer();
  const [year, setYear] = useState(years.includes("2026-2027") ? "2026-2027" : years[0]);
  const q = useQuery({
    queryKey: ["billing-lines", viewer, year],
    queryFn: () => billing.listFeeLines(viewer, year),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="School year">
        {years.map((y) => (
          <Button
            key={y}
            variant={y === year ? "primary" : "ghost"}
            aria-pressed={y === year}
            onClick={() => setYear(y)}
          >
            {y}
          </Button>
        ))}
      </div>
      {!q.data ? (
        <Spinner label="Loading fee lines" />
      ) : q.data.length === 0 ? (
        <EmptyState
          title={`No fee lines for ${year}`}
          hint="Propose one below; an Org Admin approves it."
        />
      ) : (
        <ul className="space-y-2" aria-label="Fee lines">
          {q.data.map((l) => (
            <FeeLineCard key={l.id} line={l} />
          ))}
        </ul>
      )}
      <ProposeForm year={year} />
    </div>
  );
}

function FeeLineCard({ line: l }: { line: FeeLine }) {
  const viewer = useViewer();
  const act = useBillingAction();
  const [note, setNote] = useState("");
  const label = `${l.courseCode} ${l.kind} ${l.period}`;
  return (
    <li>
      <Card className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2" data-fee-line={label}>
          <p>
            <span className="font-medium">
              {l.courseCode} · {l.kind === "tuition" ? "Tuition" : "Materials"} · {l.period}
            </span>{" "}
            <span className="text-sm text-muted">
              · {l.centerName} · {formatCenterDate(`${l.from}T00:00:00+07:00`)} →{" "}
              {formatCenterDate(`${l.to}T00:00:00+07:00`)} · due{" "}
              {formatCenterDate(`${l.dueDate}T00:00:00+07:00`)}
            </span>
          </p>
          <span className="flex items-center gap-3">
            <span className="font-semibold">{vnd(l.amountVnd)}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs">
              {LINE_STATUS[l.status]}
            </span>
          </span>
        </div>
        <p className="text-xs text-muted">
          Proposed by {l.proposedBy}
          {l.decidedBy ? ` · ${LINE_STATUS[l.status].toLowerCase()} by ${l.decidedBy}` : ""}
          {l.note ? ` · “${l.note}”` : ""}
        </p>
        {viewer.orgAdmin && l.status === "pending" ? (
          l.mine ? (
            <p className="text-sm text-muted" role="note">
              You proposed this line — another Org Admin must approve it.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button onClick={() => act.mutate(() => billing.approveFeeLine(viewer, l.id))}>
                Approve · {label}
              </Button>
              <input
                aria-label={`Reason for ${label}`}
                placeholder="Reason"
                className="rounded-ogc border border-border bg-surface p-1"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button
                variant="ghost"
                onClick={() => act.mutate(() => billing.rejectFeeLine(viewer, l.id, note))}
              >
                Reject · {label}
              </Button>
            </div>
          )
        ) : null}
        {viewer.orgAdmin && l.status === "approved" ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <input
              aria-label={`Reason for ${label}`}
              placeholder="Reason to retire"
              className="rounded-ogc border border-border bg-surface p-1"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              variant="ghost"
              onClick={() => act.mutate(() => billing.retireFeeLine(viewer, l.id, note))}
            >
              Retire · {label}
            </Button>
          </div>
        ) : null}
        <Refused r={act.data} />
      </Card>
    </li>
  );
}

function ProposeForm({ year }: { year: string }) {
  const viewer = useViewer();
  const act = useBillingAction();
  const me = useMyAccess();
  const can = me.data?.allowed["billing:manage"] ?? true;
  const start = Number(year.slice(0, 4));
  const [d, setD] = useState<FeeLineDraft>({
    year,
    courseCode: "ENG-A2",
    centerId: null,
    kind: "tuition",
    period: "Term 1",
    from: `${start}-09-01`,
    to: `${start}-11-30`,
    dueDate: `${start}-09-15`,
    amountVnd: 0,
  });
  const set = (p: Partial<FeeLineDraft>) => setD((x) => ({ ...x, ...p }));
  const field = "mt-1 block w-full rounded-ogc border border-border bg-surface p-1";
  const orgCenters = centers.filter((c) => c.orgId === viewer.orgId);
  const codes = courses.filter((c) => c.orgId === viewer.orgId).map((c) => c.code);
  return (
    <Card className="space-y-3">
      <h2 className="font-medium">Propose a fee line · {year}</h2>
      <p className="text-xs text-muted">
        It waits for an Org Admin. Only approved lines are invoiced; an approved line is never
        edited — retire it and propose a new one.
      </p>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <label>
          Course
          <select
            aria-label="Fee course"
            className={field}
            value={d.courseCode}
            onChange={(e) => set({ courseCode: e.target.value })}
          >
            {(codes.length ? codes : [d.courseCode]).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Center
          <select
            aria-label="Fee center"
            className={field}
            value={d.centerId ?? ""}
            onChange={(e) => set({ centerId: e.target.value || null })}
          >
            <option value="">All centers</option>
            {orgCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Fee
          <select
            aria-label="Fee kind"
            className={field}
            value={d.kind}
            onChange={(e) => set({ kind: e.target.value as FeeLineDraft["kind"] })}
          >
            <option value="tuition">Tuition</option>
            <option value="materials">Materials</option>
          </select>
        </label>
        <label>
          Period
          <input
            aria-label="Fee period"
            className={field}
            value={d.period}
            onChange={(e) => set({ period: e.target.value })}
          />
        </label>
        <label>
          From
          <input
            aria-label="Fee from"
            type="date"
            className={field}
            value={d.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </label>
        <label>
          To
          <input
            aria-label="Fee to"
            type="date"
            className={field}
            value={d.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </label>
        <label>
          Due
          <input
            aria-label="Fee due"
            type="date"
            className={field}
            value={d.dueDate}
            onChange={(e) => set({ dueDate: e.target.value })}
          />
        </label>
        <label>
          Amount (VND)
          <input
            aria-label="Fee amount"
            type="number"
            className={field}
            value={d.amountVnd || ""}
            onChange={(e) => set({ amountVnd: Number(e.target.value) })}
          />
        </label>
      </div>
      <Button
        disabled={!can}
        onClick={() => act.mutate(() => billing.proposeFeeLine(viewer, { ...d, year }))}
      >
        Propose fee line
      </Button>
      {act.data?.ok ? (
        <p role="status" className="text-sm">
          Proposed — waiting for an Org Admin.
        </p>
      ) : null}
      <Refused r={act.data} />
    </Card>
  );
}

// ── Invoices ────────────────────────────────────────────────────────────────────────────────

function Invoices() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["billing-invoices", viewer],
    queryFn: () => billing.listInvoices(viewer),
  });
  const [filter, setFilter] = useState<"open" | "all">("open");
  if (!q.data) return <Spinner label="Loading invoices" />;
  const list = filter === "open" ? q.data.filter((i) => i.balanceVnd > 0) : q.data;
  return (
    <div className="space-y-4">
      <Generate />
      <div className="flex gap-2" role="group" aria-label="Invoice filter">
        <Button
          variant={filter === "open" ? "primary" : "ghost"}
          aria-pressed={filter === "open"}
          onClick={() => setFilter("open")}
        >
          Open ({q.data.filter((i) => i.balanceVnd > 0).length})
        </Button>
        <Button
          variant={filter === "all" ? "primary" : "ghost"}
          aria-pressed={filter === "all"}
          onClick={() => setFilter("all")}
        >
          All ({q.data.length})
        </Button>
      </div>
      {list.length === 0 ? (
        <EmptyState title="Nothing open" hint="Every invoice in your centers is paid or void." />
      ) : (
        <ul className="space-y-2" aria-label="Invoices">
          {list.map((i) => (
            <InvoiceCard key={i.id} inv={i} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Generate() {
  const viewer = useViewer();
  const me = useMyAccess();
  const can = me.data?.allowed["billing:manage"] ?? true;
  const periods = useQuery({
    queryKey: ["billing-periods", viewer],
    queryFn: () => billing.periods(viewer),
  });
  const [pick, setPick] = useState("");
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: ({ year, period }: { year: string; period: string }) =>
      billing.generateInvoices(viewer, year, period),
    onSuccess: () => refreshLearningState(qc),
  });
  const list = periods.data ?? [];
  const cur = list.find((p) => p.current) ?? list[list.length - 1];
  const chosen = pick || (cur ? `${cur.year}|${cur.period}` : "");
  const r = act.data;
  return (
    <Card className="flex flex-wrap items-end gap-3 text-sm">
      <label>
        <span className="block text-xs text-muted">Period (approved tuition lines)</span>
        <select
          aria-label="Invoice period"
          className="rounded-ogc border border-border bg-surface p-1"
          value={chosen}
          onChange={(e) => setPick(e.target.value)}
        >
          {list.map((p) => (
            <option key={`${p.year}|${p.period}`} value={`${p.year}|${p.period}`}>
              {p.period} {p.year}
              {p.current ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={!can || !chosen}
        onClick={() => {
          const [year, period] = chosen.split("|");
          act.mutate({ year, period });
        }}
      >
        Generate invoices
      </Button>
      {r?.ok ? (
        <p role="status">
          {r.created} created · {r.existing} already invoiced
          {r.skippedNoLine.length ? ` · no approved line: ${r.skippedNoLine.join(", ")}` : ""}
        </p>
      ) : null}
      <Refused r={r} />
    </Card>
  );
}

function InvoiceCard({ inv: i }: { inv: Invoice }) {
  const viewer = useViewer();
  const act = useBillingAction();
  const me = useMyAccess();
  const can = me.data?.allowed["billing:manage"] ?? true;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [why, setWhy] = useState("");
  const open = i.status === "issued" || i.status === "partially_paid";
  return (
    <li>
      <Card className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2" data-invoice={i.no}>
          <p>
            <span className="font-medium">{i.no}</span> · {i.learnerName}{" "}
            <span className="text-sm text-muted">
              · {i.centerName}
              {i.payerName ? ` · payer ${i.payerName}` : " · pays at the desk"}
              {i.billTo.kind === "lead" ? " · referral, first invoice" : ""}
            </span>
          </p>
          <span className="flex items-center gap-3">
            {i.daysOverdue > 0 ? (
              <span className="text-xs text-danger">{i.daysOverdue} days overdue</span>
            ) : null}
            <span className="rounded-full border border-border px-2 py-0.5 text-xs">
              {INVOICE_STATUS[i.status]}
            </span>
          </span>
        </div>
        <InvoiceLines inv={i} />
        {i.voidReason ? <p className="text-sm text-muted">Void: {i.voidReason}</p> : null}
        {can && open ? (
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <input
              aria-label={`Amount for ${i.no}`}
              type="number"
              placeholder={String(i.balanceVnd)}
              className="w-36 rounded-ogc border border-border bg-surface p-1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <select
              aria-label={`Method for ${i.no}`}
              className="rounded-ogc border border-border bg-surface p-1"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {Object.entries(METHOD).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <Button
              onClick={() =>
                act.mutate(() =>
                  billing.recordPayment(viewer, i.id, Number(amount || i.balanceVnd), method),
                )
              }
            >
              Record payment · {i.no}
            </Button>
            {i.paidVnd === 0 ? (
              <>
                <input
                  aria-label={`Void reason for ${i.no}`}
                  placeholder="Reason to void"
                  className="rounded-ogc border border-border bg-surface p-1"
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                />
                <Button
                  variant="ghost"
                  onClick={() => act.mutate(() => billing.voidInvoice(viewer, i.id, why))}
                >
                  Void · {i.no}
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        {act.data?.ok && "receiptNo" in act.data ? (
          <p role="status" className="text-sm">
            Receipt {String(act.data.receiptNo)} (mock)
          </p>
        ) : null}
        <Refused r={act.data} />
      </Card>
    </li>
  );
}

export function InvoiceLines({ inv: i }: { inv: Invoice }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {i.lines.map((l) => (
          <tr key={l.feeLineId}>
            <td className="py-0.5">{l.description}</td>
            <td className="py-0.5 text-right">{vnd(l.amountVnd)}</td>
          </tr>
        ))}
        {i.creditAppliedVnd > 0 ? (
          <tr>
            <td className="py-0.5">Referral credit applied</td>
            <td className="py-0.5 text-right">−{vnd(i.creditAppliedVnd)}</td>
          </tr>
        ) : null}
        <tr className="border-t border-border font-medium">
          <td className="py-0.5">Total · due {formatCenterDate(`${i.dueDate}T00:00:00+07:00`)}</td>
          <td className="py-0.5 text-right">{vnd(i.totalVnd)}</td>
        </tr>
        <tr className="text-muted">
          <td className="py-0.5">Paid · balance</td>
          <td className="py-0.5 text-right" data-testid={`balance-${i.no}`}>
            {vnd(i.paidVnd)} · {vnd(i.balanceVnd)}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Payments + receivables ─────────────────────────────────────────────────────────────────

function Payments() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["billing-payments", viewer],
    queryFn: () => billing.listPayments(viewer),
  });
  if (!q.data) return <Spinner label="Loading payments" />;
  if (q.data.length === 0) return <EmptyState title="No payments recorded" />;
  return (
    <Card>
      <table className="w-full text-sm" aria-label="Payments">
        <thead className="text-left text-xs uppercase text-muted">
          <tr>
            <th className="py-1">Receipt</th>
            <th>Invoice</th>
            <th>Learner</th>
            <th>Date</th>
            <th>Method</th>
            <th className="text-right">Amount</th>
            <th>Recorded by</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="py-1">{p.receiptNo}</td>
              <td>{p.invoiceNo}</td>
              <td>{p.learnerName}</td>
              <td>{formatCenterDate(p.at)}</td>
              <td>{METHOD[p.method]}</td>
              <td className="text-right">{vnd(p.amountVnd)}</td>
              <td>{p.recordedBy}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ReceivablesView() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["billing-receivables", viewer],
    queryFn: () => billing.getReceivables(viewer),
  });
  const r = q.data;
  if (!r) return <Spinner label="Loading receivables" />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Outstanding"
          value={<span data-testid="outstanding">{vnd(r.outstandingVnd)}</span>}
        />
        <StatTile
          label="Overdue"
          value={<span data-testid="overdue">{vnd(r.overdueVnd)}</span>}
          hint={`${r.overdue.length} invoices`}
        />
        <StatTile label="Collected" value={vnd(r.collectedVnd)} />
        <StatTile label="Referral credit applied" value={vnd(r.creditAppliedVnd)} />
      </div>
      <Card>
        <h2 className="mb-2 font-medium">Aging by center</h2>
        {r.byCenter.length === 0 ? (
          <p className="text-sm text-muted">Nothing owed.</p>
        ) : (
          <table className="w-full text-sm" aria-label="Aging by center">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="py-1">Center</th>
                <th className="text-right">Not due</th>
                <th className="text-right">1–30 days</th>
                <th className="text-right">31–60 days</th>
                <th className="text-right">Over 60 days</th>
              </tr>
            </thead>
            <tbody>
              {r.byCenter.map((c) => (
                <tr key={c.centerId} className="border-t border-border">
                  <td className="py-1">{c.centerName}</td>
                  <td className="text-right">{vnd(c.notDueVnd)}</td>
                  <td className="text-right">{vnd(c.d1to30Vnd)}</td>
                  <td className="text-right">{vnd(c.d31to60Vnd)}</td>
                  <td className="text-right">{vnd(c.over60Vnd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">Overdue invoices</h2>
        {r.overdue.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ul className="space-y-1 text-sm" aria-label="Overdue invoices">
            {r.overdue.map((i) => (
              <li key={i.id} className="flex justify-between gap-2">
                <span>
                  {i.no} · {i.learnerName} · {i.centerName}
                </span>
                <span>
                  {vnd(i.balanceVnd)} · <span className="text-danger">{i.daysOverdue} days</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Learning and attendance continue as normal.</p>
      </Card>
    </div>
  );
}
