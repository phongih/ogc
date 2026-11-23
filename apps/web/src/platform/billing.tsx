// Billing on the Platform: the shared views (features/billing) over the Platform API, plus the
// "Issue first invoice" action Admissions shows on a lead at placement. Synthetic: nothing is charged.
import { useMemo, type ReactNode } from "react";
import type { Lead } from "@ogc/contracts";
import {
  BillingApiContext,
  TuitionApiContext,
  type BillingApi,
  type TuitionApi,
} from "../features/billing/billingApi";
import { Refused, useAdmissionsAction } from "../features/admissions/AdmissionsView";
import { Button } from "../ui";
import { platformApi } from "./client";
import { useSignedIn } from "./App";
import { PolicyBanner, useMyPlatformAccess } from "./workforce";
import { ReferToPartner } from "../features/partners/ReferToPartner";
import { useCanRefer, usePlatformReferApi } from "./partners";

function useCanManage(): boolean {
  const q = useMyPlatformAccess();
  return q.data ? q.data.allowed.includes("billing:manage") : true;
}
const useIsOrgAdmin = () => useSignedIn().orgAdmin === true;

const NOTE =
  "Staging, synthetic data — nothing is charged, paid or invoiced for real. An overdue invoice never blocks learning or attendance; it shows in Receivables.";

export function PlatformBillingApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<BillingApi>(
    () => ({
      key: ["billing", s.principalId],
      subtitle: "Fee plans · invoices · receivables · staging",
      note: NOTE,
      back: null,
      Banner: PolicyBanner,
      useCanManage,
      useIsOrgAdmin,
      options: () => platformApi.billingOptions(s),
      years: () => platformApi.billingYears(s),
      listFeeLines: (year) => platformApi.feeLines(s, year),
      proposeFeeLine: (d) => platformApi.proposeFeeLine(s, d),
      approveFeeLine: (id) => platformApi.decideFeeLine(s, id, "approve"),
      rejectFeeLine: (id, note) => platformApi.decideFeeLine(s, id, "reject", note),
      retireFeeLine: (id, note) => platformApi.decideFeeLine(s, id, "retire", note),
      periods: () => platformApi.billingPeriods(s),
      generateInvoices: (y, p) => platformApi.generateInvoices(s, y, p),
      listInvoices: () => platformApi.invoices(s),
      recordPayment: (id, amount, method) => platformApi.recordPayment(s, id, amount, method),
      voidInvoice: (id, reason) => platformApi.voidInvoice(s, id, reason),
      listPayments: () => platformApi.payments(s),
      getReceivables: () => platformApi.receivables(s),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <BillingApiContext.Provider value={api}>{children}</BillingApiContext.Provider>;
}

export function PlatformTuitionApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<TuitionApi>(
    () => ({
      key: ["tuition", s.principalId],
      subtitle: "Invoices and payments · staging",
      note: "Staging, synthetic data — nothing is charged or paid. Pay at your center; staff record the payment.",
      showWallet: false,
      getMine: () => platformApi.myBilling(s),
    }),
    [s],
  );
  return <TuitionApiContext.Provider value={api}>{children}</TuitionApiContext.Provider>;
}

/**
 * Admissions → an open lead: "Refer to partner" (Partner Commissions decides); at "placement test
 * done": issue its first invoice (Billing decides).
 */
export function PlatformLeadActions({ lead: l }: { lead: Lead }) {
  const canRefer = useCanRefer();
  const referApi = usePlatformReferApi();
  return (
    <>
      {canRefer && l.stage !== "offer" ? (
        <ReferToPartner leadId={l.id} learnerName={l.learnerName} api={referApi} />
      ) : null}
      {l.stage === "placement" ? <FirstInvoiceButton lead={l} /> : null}
    </>
  );
}

function FirstInvoiceButton({ lead: l }: { lead: Lead }) {
  const s = useSignedIn();
  const act = useAdmissionsAction();
  const can = useCanManage();
  return (
    <>
      <Button
        disabled={!can}
        onClick={() => act.mutate(() => platformApi.issueFirstInvoice(s, l.id))}
      >
        Issue first invoice · {l.learnerName}
      </Button>
      <Refused r={act.data} />
    </>
  );
}
