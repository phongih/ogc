// The demo's partner APIs: the in-browser mock with the caller's granted context. Demo only.
import { useMemo, type ReactNode } from "react";
import { partners } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { AccessBanner } from "../access/AccessBanner";
import { PartnersApiContext, type PartnersApi, type ReferApi } from "./partnersApi";

export function DemoPartnersApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<PartnersApi>(
    () => ({
      key: ["partners-demo", viewer],
      subtitle: "Leads handed to partner centers · tiered commissions · synthetic demo",
      back: { to: "/app/operations", label: "← Center operations" },
      Banner: AccessBanner,
      getOverview: () => partners.getOverview(viewer),
      listPartners: () => partners.listPartners(viewer),
      listEntries: () => partners.listEntries(viewer),
      listActivity: () => partners.listActivity(viewer),
      markEnrolled: (id) => partners.markEnrolled(viewer, id),
      reject: (id, reason) => partners.reject(viewer, id, reason),
      approve: (id) => partners.approve(viewer, id),
      proposeRule: (pid, d) => partners.proposeRule(viewer, pid, d),
      decideRule: (rid, decision) => partners.decideRule(viewer, rid, decision),
      actOnSignal: (sid, action, note) => partners.actOnSignal(viewer, sid, action, note),
      listBatches: () => partners.listBatches(viewer),
      batchCandidates: () => partners.batchCandidates(viewer),
      draftBatch: (pid, label) => partners.draftBatch(viewer, pid, label),
      sendBatch: (id) => partners.sendBatch(viewer, id),
      markBatchPaid: (id, ref) => partners.markBatchPaid(viewer, id, ref),
      cancelBatch: (id, reason) => partners.cancelBatch(viewer, id, reason),
      previewReport: (pid, csv) => partners.previewReport(viewer, pid, csv),
      applyReportRow: (pid, row) => partners.applyReportRow(viewer, pid, row),
      getTrends: () => partners.getTrends(viewer),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <PartnersApiContext.Provider value={api}>{children}</PartnersApiContext.Provider>;
}

/** Admissions (demo) → "Refer to partner". */
export function useDemoReferApi(): ReferApi {
  const viewer = useViewer();
  return useMemo(
    () => ({
      key: ["partners-demo", viewer],
      suggest: (leadId: string) => partners.suggestPartners(viewer, leadId),
      refer: (leadId: string, partnerId: string) => partners.referLead(viewer, leadId, partnerId),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
}
