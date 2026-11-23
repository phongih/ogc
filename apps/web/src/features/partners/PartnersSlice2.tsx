/*
 * Partner Commissions slice 2 (owner decisions 22/11): settlement batches (staff draft, an Org
 * Admin sends — then locked — the partner pays the whole batch), partner reports previewed and
 * applied one row at a time by a person, and six-month trends per partner with their counts.
 * Mock receivable — nothing is invoiced or paid. SYNTHETIC. Shared by the demo and the Platform
 * through `PartnersApiContext`.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PartnersResult, ReportMatch, ReportRow, SettlementBatch } from "@ogc/contracts";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card } from "../../ui";
import { vnd } from "../growth/format";
import { Refused } from "./refused";
import { usePartnersApi } from "./partnersApi";

function useAction() {
  const api = usePartnersApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<PartnersResult>) => run(),
    onSuccess: () => api.onChanged(qc),
  });
}

const BATCH_LABEL = {
  draft: "Draft",
  sent: "Sent · locked",
  paid: "Paid",
  cancelled: "Cancelled",
} as const;

// ── Settlements ─────────────────────────────────────────────────────────────────────────────

export function Settlements({ isAdmin }: { isAdmin: boolean }) {
  const api = usePartnersApi();
  const act = useAction();
  const cand = useQuery({
    queryKey: [...api.key, "partners-candidates"],
    queryFn: () => api.batchCandidates(),
  });
  const list = useQuery({
    queryKey: [...api.key, "partners-batches"],
    queryFn: () => api.listBatches(),
  });
  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-semibold">Ready to batch</h2>
        <p className="mb-2 text-xs text-muted">
          Approved entries not in a batch yet, by partner and enrolment cycle. Staff draft a batch;
          an Org Admin who did not draft it sends it — then it is locked. The partner pays the whole
          batch.
        </p>
        {(cand.data ?? []).length === 0 ? (
          <p className="text-sm text-muted">Nothing approved outside a batch.</p>
        ) : null}
        <ul className="space-y-1 text-sm" aria-label="Ready to batch">
          {(cand.data ?? []).map((c) => (
            <li
              key={`${c.partnerId}|${c.cycleLabel}`}
              className="flex flex-wrap items-center gap-2"
            >
              <span className="font-medium">{c.partnerName}</span>
              <span className="text-muted">
                {c.cycleLabel} · {c.entries} {c.entries === 1 ? "entry" : "entries"} ·{" "}
                {vnd(c.totalVnd)}
              </span>
              <Button
                variant="ghost"
                onClick={() => act.mutate(() => api.draftBatch(c.partnerId, c.cycleLabel))}
              >
                Draft batch · {c.partnerName} · {c.cycleLabel}
              </Button>
            </li>
          ))}
        </ul>
        <Refused r={act.data} />
      </Card>
      <ul className="space-y-2" aria-label="Settlement batches">
        {(list.data ?? []).map((b) => (
          <li key={b.id}>
            <BatchCard b={b} isAdmin={isAdmin} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function BatchCard({ b, isAdmin }: { b: SettlementBatch; isAdmin: boolean }) {
  const api = usePartnersApi();
  const act = useAction();
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const canCancel = b.status === "draft" || (b.status === "sent" && isAdmin);
  return (
    <Card>
      <section aria-label={`Batch ${b.id}`} className="space-y-1 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-semibold">{b.id}</span>
          <span className="text-muted">
            {b.partnerName} · {b.cycleLabel}
          </span>
          <span
            className={`ml-auto ${b.overdue || b.status === "cancelled" ? "text-danger" : ""}`}
            data-testid={`batch-status-${b.id}`}
          >
            {BATCH_LABEL[b.status]}
            {b.overdue ? " · overdue" : ""}
          </span>
        </div>
        <p className="font-medium">
          {vnd(b.totalVnd)} · {b.entries.length} {b.entries.length === 1 ? "entry" : "entries"}
        </p>
        <ul className="text-xs text-muted">
          {b.entries.map((e) => (
            <li key={e.id}>
              {e.leadRefCode} · {e.learnerDisplayName} · {vnd(e.amountVnd)}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">
          Drafted by {b.createdBy} {formatCenterDate(b.createdAt)}
          {b.sentBy ? ` · sent by ${b.sentBy} ${formatCenterDate(b.sentAt!)}` : ""}
          {b.dueDate ? ` · due ${formatCenterDate(b.dueDate)}` : ""}
          {b.paidBy
            ? ` · paid, recorded by ${b.paidBy} ${formatCenterDate(b.paidAt!)} · ref ${b.paymentRef}`
            : ""}
          {b.cancelReason ? ` · cancelled: ${b.cancelReason}` : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {b.status === "draft" && isAdmin && !b.mine ? (
            <Button onClick={() => act.mutate(() => api.sendBatch(b.id))}>Send · {b.id}</Button>
          ) : null}
          {b.status === "draft" && (!isAdmin || b.mine) ? (
            <span className="text-xs text-muted">
              Waiting for an Org Admin who did not draft it to send it.
            </span>
          ) : null}
          {b.status === "sent" ? (
            <>
              <input
                aria-label={`Payment reference · ${b.id}`}
                placeholder="Payment ref, e.g. BANK-1234"
                className="rounded-ogc border border-border bg-surface p-1"
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              />
              <Button
                variant="ghost"
                onClick={() => act.mutate(() => api.markBatchPaid(b.id, ref))}
              >
                Partner paid the whole batch · {b.id}
              </Button>
            </>
          ) : null}
          {canCancel ? (
            <>
              <input
                aria-label={`Cancel reason · ${b.id}`}
                placeholder="Why cancel?"
                className="rounded-ogc border border-border bg-surface p-1"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="ghost"
                onClick={() => act.mutate(() => api.cancelBatch(b.id, reason))}
              >
                Cancel · {b.id}
              </Button>
            </>
          ) : null}
        </div>
        <Refused r={act.data} />
      </section>
    </Card>
  );
}

// ── Import report ───────────────────────────────────────────────────────────────────────────

const MATCH_LABEL: Record<ReportMatch, string> = {
  applicable: "Can be applied",
  already: "Already in the ledger",
  conflict: "Conflict — not applied",
  not_found: "Unknown code",
  invalid: "Not valid",
};

export function ImportReport() {
  const api = usePartnersApi();
  const plist = useQuery({
    queryKey: [...api.key, "partners-list"],
    queryFn: () => api.listPartners(),
  });
  const [partnerId, setPartnerId] = useState("");
  const [csv, setCsv] = useState("");
  const [rows, setRows] = useState<ReportRow[] | null>(null);
  const pid = partnerId || plist.data?.[0]?.id || "";
  const preview = async () => setRows(await api.previewReport(pid, csv));
  return (
    <Card>
      <h2 className="mb-1 font-semibold">Import a partner report</h2>
      <p className="mb-2 text-xs text-muted">
        Paste the partner&apos;s report, one line per learner: <code>code,status,date,reason</code>{" "}
        — e.g. <code>LR-1004,enrolled,2026-11-20</code> or{" "}
        <code>LR-1011,rejected,,did not enrol</code>. Preview compares it with the ledger; nothing
        changes until you apply a row.
      </p>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>
          <span className="block text-xs text-muted">Partner</span>
          <select
            aria-label="Report partner"
            className="rounded-ogc border border-border bg-surface p-1"
            value={pid}
            onChange={(e) => {
              setPartnerId(e.target.value);
              setRows(null);
            }}
          >
            {(plist.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        aria-label="Report lines"
        rows={5}
        className="mt-2 w-full rounded-ogc border border-border bg-surface p-2 font-mono text-sm"
        value={csv}
        onChange={(e) => {
          setCsv(e.target.value);
          setRows(null);
        }}
      />
      <Button disabled={!csv.trim() || !pid} onClick={() => void preview()}>
        Preview
      </Button>
      {rows ? (
        <table className="mt-3 w-full text-sm" aria-label="Report preview">
          <thead>
            <tr className="text-left text-muted">
              {["Line", "Code", "Learner", "Reported", "Result", ""].map((h) => (
                <th key={h} scope="col" className="py-1 pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PreviewRow key={r.line} r={r} partnerId={pid} onApplied={() => void preview()} />
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}

function PreviewRow({
  r,
  partnerId,
  onApplied,
}: {
  r: ReportRow;
  partnerId: string;
  onApplied: () => void;
}) {
  const api = usePartnersApi();
  const act = useAction();
  return (
    <tr
      className="border-t border-border align-top"
      data-testid={`report-${r.leadRefCode ?? r.line}`}
    >
      <td className="py-1 pr-3">{r.line}</td>
      <td className="py-1 pr-3">{r.leadRefCode ?? "—"}</td>
      <td className="py-1 pr-3">{r.learnerDisplayName ?? "—"}</td>
      <td className="py-1 pr-3">
        {r.reported ?? "—"}
        {r.date ? ` · ${r.date}` : ""}
      </td>
      <td
        className={`py-1 pr-3 ${r.match === "conflict" || r.match === "invalid" ? "text-danger" : ""}`}
      >
        {MATCH_LABEL[r.match]} — {r.explanation}
      </td>
      <td className="py-1">
        {r.match === "applicable" ? (
          <Button
            variant="ghost"
            onClick={() =>
              act.mutate(() => api.applyReportRow(partnerId, r), {
                onSuccess: (x) => x.ok && onApplied(),
              })
            }
          >
            Apply · {r.leadRefCode}
          </Button>
        ) : null}
        <Refused r={act.data} />
      </td>
    </tr>
  );
}

// ── Trends ──────────────────────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export function Trends() {
  const api = usePartnersApi();
  const q = useQuery({
    queryKey: [...api.key, "partners-trends"],
    queryFn: () => api.getTrends(),
  });
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        By referral month: of the learners referred that month, how many enrolled, were rejected or
        are still open. Conversion = enrolled ÷ (enrolled + rejected), always with its counts.
      </p>
      {(q.data ?? []).map((p) => (
        <Card key={p.partnerId}>
          <h2 className="mb-2 font-semibold">{p.partnerName}</h2>
          <table className="w-full text-sm" aria-label={`Trend · ${p.partnerName}`}>
            <thead>
              <tr className="text-left text-muted">
                {[
                  "Referred in",
                  "Referred",
                  "Enrolled",
                  "Rejected",
                  "Open",
                  "Conversion",
                  "Median days to enrol",
                ].map((h) => (
                  <th key={h} scope="col" className="py-1 pr-3 font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.months.map((m) => (
                <tr key={m.month} className="border-t border-border">
                  <td className="py-1 pr-3">{monthLabel(m.month)}</td>
                  <td className="py-1 pr-3">{m.referred}</td>
                  <td className="py-1 pr-3">{m.enrolled}</td>
                  <td className="py-1 pr-3">{m.rejected}</td>
                  <td className="py-1 pr-3">{m.open}</td>
                  <td className="py-1 pr-3">
                    {m.conversion.pct === null
                      ? "—"
                      : `${m.conversion.pct}% (${m.conversion.n} of ${m.conversion.d})`}
                  </td>
                  <td className="py-1 pr-3">{m.medianDaysToEnrol ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
