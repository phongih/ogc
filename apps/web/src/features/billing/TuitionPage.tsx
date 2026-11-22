/*
 * Tuition — a guardian's (or adult learner's) own invoices, read-only (owner decisions 22/11).
 * Referral credit shows where it was applied. Payment happens at the center (demo: nothing is
 * charged or paid, no online payment). A learner under 18 sees a note: their guardian pays.
 */
import { useQuery } from "@tanstack/react-query";
import { billing } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { vnd } from "../growth/format";
import { INVOICE_STATUS, InvoiceLines } from "./BillingPage";

export function TuitionPage() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["billing-mine", viewer],
    queryFn: () => billing.getMine(viewer),
  });
  if (q.isLoading) return <Spinner label="Loading tuition" />;
  if (q.isError)
    return <ErrorState message="Could not load tuition." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <EmptyState
        title="Tuition is handled by your guardian"
        hint="Invoices go to the guardian of a learner under 18."
      />
    );
  const d = q.data;
  return (
    <section className="space-y-4">
      <PageHeader title="Tuition" subtitle="Invoices and payments · synthetic demo" />
      <p className="text-xs text-muted">
        Demo only — nothing is charged or paid. Pay at your center; staff record the payment.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile
          label="To pay"
          value={<span data-testid="to-pay">{vnd(d.outstandingVnd)}</span>}
        />
        <StatTile
          label="Referral credit waiting"
          value={vnd(d.walletVnd)}
          hint="applied automatically to your next invoice"
        />
      </div>
      {d.invoices.length === 0 ? (
        <EmptyState title="No invoices yet" />
      ) : (
        <ul className="space-y-2" aria-label="My invoices">
          {d.invoices.map((i) => (
            <li key={i.id}>
              <Card className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p>
                    <span className="font-medium">{i.no}</span> · {i.learnerName}{" "}
                    <span className="text-sm text-muted">· {i.centerName}</span>
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
                {i.payments.length ? (
                  <p className="text-xs text-muted">
                    Receipts:{" "}
                    {i.payments.map((p) => `${p.receiptNo} (${vnd(p.amountVnd)})`).join(", ")}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
