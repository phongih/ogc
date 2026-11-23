// The demo's admissions API: the in-browser mock with the caller's granted context, plus the
// demo's Billing and Partner actions on a lead. Demo only.
import { useMemo, type ReactNode } from "react";
import type { Lead } from "@ogc/contracts";
import { admissions, billing } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { centers } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { Button } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import { ReferToPartner } from "../partners/ReferToPartner";
import { useDemoReferApi } from "../partners/demoPartnersApi";
import { AdmissionsApiContext, type AdmissionsApi } from "./admissionsApi";
import { Refused, useAdmissionsAction } from "./AdmissionsView";

const useCanManage = () => useMyAccess().data?.allowed["admissions:manage"] ?? true;

function DemoLeadActions({ lead: l }: { lead: Lead }) {
  const viewer = useViewer();
  const act = useAdmissionsAction();
  const me = useMyAccess();
  const canBill = me.data?.allowed["billing:manage"] ?? true;
  const canRefer = me.data?.allowed["partners:manage"] ?? false;
  const referApi = useDemoReferApi();
  return (
    <>
      {canRefer && l.stage !== "offer" ? (
        <ReferToPartner leadId={l.id} learnerName={l.learnerName} api={referApi} />
      ) : null}
      {l.stage === "placement" ? (
        <Button
          disabled={!canBill}
          onClick={() => act.mutate(() => billing.issueFirstInvoice(viewer, l.id))}
        >
          Issue first invoice · {l.learnerName}
        </Button>
      ) : null}
      <Refused r={act.data} />
    </>
  );
}

export function DemoAdmissionsApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<AdmissionsApi>(
    () => ({
      key: ["admissions-demo", viewer],
      subtitle: "Pipeline · lead score · funnel · synthetic demo",
      back: { to: "/app/operations", label: "← Center operations" },
      Banner: AccessBanner,
      LeadActions: DemoLeadActions,
      billingLink: "/app/operations/billing",
      useCanManage,
      options: async () => ({
        centers: centers
          .filter((c) => c.orgId === viewer.orgId)
          .map((c) => ({ id: c.id, name: c.name })),
        courseCodes: courses.filter((c) => c.orgId === viewer.orgId).map((c) => c.code),
      }),
      listLeads: () => admissions.listLeads(viewer),
      counselors: () => admissions.counselors(viewer),
      createLead: (d) => admissions.createLead(viewer, d),
      assign: (id, who) => admissions.assign(viewer, id, who),
      moveStage: (id, stage, reason) => admissions.moveStage(viewer, id, stage, reason),
      logActivity: (id, kind, text) => admissions.logActivity(viewer, id, kind, text),
      getDashboard: () => admissions.getDashboard(viewer),
      getSettings: () => admissions.getSettings(viewer),
      updateSettings: (s) => admissions.updateSettings(viewer, s),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <AdmissionsApiContext.Provider value={api}>{children}</AdmissionsApiContext.Provider>;
}
