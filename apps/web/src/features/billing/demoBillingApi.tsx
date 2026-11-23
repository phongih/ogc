// The demo's billing APIs: the in-browser mock with the caller's granted context. Demo only.
import { useMemo, type ReactNode } from "react";
import { billing } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { centers } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import {
  BillingApiContext,
  TuitionApiContext,
  type BillingApi,
  type TuitionApi,
} from "./billingApi";

const useCanManage = () => useMyAccess().data?.allowed["billing:manage"] ?? true;
const useIsOrgAdmin = () => useViewer().orgAdmin === true;

export function DemoBillingApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<BillingApi>(
    () => ({
      key: ["billing-demo", viewer],
      subtitle: "Fee plans · invoices · receivables · synthetic demo",
      note: "Demo only — nothing is charged, paid or invoiced for real. An overdue invoice never blocks learning or attendance; staff are told in Receivables and by the Decision Engine.",
      back: { to: "/app/operations", label: "← Center operations" },
      Banner: AccessBanner,
      useCanManage,
      useIsOrgAdmin,
      options: async () => ({
        centers: centers
          .filter((c) => c.orgId === viewer.orgId)
          .map((c) => ({ id: c.id, name: c.name })),
        courseCodes: courses.filter((c) => c.orgId === viewer.orgId).map((c) => c.code),
        allCenters: true,
      }),
      years: () => billing.years(viewer),
      listFeeLines: (year) => billing.listFeeLines(viewer, year),
      proposeFeeLine: (d) => billing.proposeFeeLine(viewer, d),
      approveFeeLine: (id) => billing.approveFeeLine(viewer, id),
      rejectFeeLine: (id, note) => billing.rejectFeeLine(viewer, id, note),
      retireFeeLine: (id, note) => billing.retireFeeLine(viewer, id, note),
      periods: () => billing.periods(viewer),
      generateInvoices: (y, p) => billing.generateInvoices(viewer, y, p),
      listInvoices: () => billing.listInvoices(viewer),
      recordPayment: (id, amount, method) => billing.recordPayment(viewer, id, amount, method),
      voidInvoice: (id, reason) => billing.voidInvoice(viewer, id, reason),
      listPayments: () => billing.listPayments(viewer),
      getReceivables: () => billing.getReceivables(viewer),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <BillingApiContext.Provider value={api}>{children}</BillingApiContext.Provider>;
}

export function DemoTuitionApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<TuitionApi>(
    () => ({
      key: ["billing-mine-demo", viewer],
      subtitle: "Invoices and payments · synthetic demo",
      note: "Demo only — nothing is charged or paid. Pay at your center; staff record the payment.",
      showWallet: true,
      getMine: () => billing.getMine(viewer),
    }),
    [viewer],
  );
  return <TuitionApiContext.Provider value={api}>{children}</TuitionApiContext.Provider>;
}
