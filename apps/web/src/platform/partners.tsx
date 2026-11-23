// Partner Commissions on the Platform: the shared views (features/partners) over the Platform API,
// and the "Refer to partner" action Admissions shows on an open lead. A mock receivable.
import { useMemo, type ReactNode } from "react";
import {
  PartnersApiContext,
  type PartnersApi,
  type ReferApi,
} from "../features/partners/partnersApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";
import { PolicyBanner, useMyPlatformAccess } from "./workforce";

/** UI hint: may the caller refer leads to partners (the API decides). */
export function useCanRefer(): boolean {
  const q = useMyPlatformAccess();
  return q.data ? q.data.allowed.includes("partners:manage") : false;
}

export function PlatformPartnersApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<PartnersApi>(
    () => ({
      key: ["partners", s.principalId],
      subtitle: "Leads handed to partner centers · tiered commissions · staging",
      back: null,
      Banner: PolicyBanner,
      getOverview: () => platformApi.partnersOverview(s),
      listPartners: () => platformApi.partners(s),
      listEntries: () => platformApi.partnerEntries(s),
      listActivity: () => platformApi.partnerActivity(s),
      markEnrolled: (id) => platformApi.partnerEntryStep(s, id, "enrolled"),
      reject: (id, reason) => platformApi.partnerEntryStep(s, id, "reject", { reason }),
      approve: (id) => platformApi.partnerEntryStep(s, id, "approve"),
      proposeRule: (pid, d) => platformApi.proposePartnerRule(s, pid, d),
      decideRule: (rid, decision) => platformApi.decidePartnerRule(s, rid, decision),
      actOnSignal: (sid, action, note) => platformApi.actOnPartnerSignal(s, sid, action, note),
      listBatches: () => platformApi.partnerBatches(s),
      batchCandidates: () => platformApi.partnerBatchCandidates(s),
      draftBatch: (pid, label) => platformApi.draftPartnerBatch(s, pid, label),
      sendBatch: (id) => platformApi.partnerBatchStep(s, id, "send"),
      markBatchPaid: (id, ref) => platformApi.partnerBatchStep(s, id, "paid", { paymentRef: ref }),
      cancelBatch: (id, reason) => platformApi.partnerBatchStep(s, id, "cancel", { reason }),
      previewReport: (pid, csv) => platformApi.previewPartnerReport(s, pid, csv),
      applyReportRow: (pid, row) => platformApi.applyPartnerReportRow(s, pid, row),
      getTrends: () => platformApi.partnerTrends(s),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <PartnersApiContext.Provider value={api}>{children}</PartnersApiContext.Provider>;
}

export function usePlatformReferApi(): ReferApi {
  const s = useSignedIn();
  return useMemo(
    () => ({
      key: ["partners", s.principalId],
      suggest: (leadId: string) => platformApi.suggestPartners(s, leadId),
      refer: (leadId: string, partnerId: string) => platformApi.referLead(s, leadId, partnerId),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
}
