/*
 * Tuition — a guardian's (or adult learner's) own invoices, read-only (owner decisions 22/11).
 * Referral credit shows where it was applied. Payment happens at the center (demo: nothing is
 * charged or paid, no online payment). A learner under 18 sees a note: their guardian pays.
 * Shared by the demo and the Platform through `TuitionApiContext`.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { vnd } from "../growth/format";
import { INVOICE_STATUS, InvoiceLines } from "./BillingView";
import { useTuitionApi } from "./billingApi";

export function TuitionView() {
  const api = useTuitionApi();
  const q = useQuery({
    queryKey: [...api.key, "billing-mine"],
    queryFn: () => api.getMine(),
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
      <PageHeader title="Tuition" subtitle={api.subtitle} />
      <p className="text-xs text-muted">{api.note}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTile
          label="To pay"
          value={<span data-testid="to-pay">{vnd(d.outstandingVnd)}</span>}
        />
        {api.showWallet ? (
          <StatTile
            label="Referral credit waiting"
            value={vnd(d.walletVnd)}
            hint="applied automatically to your next invoice"
          />
        ) : null}
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
