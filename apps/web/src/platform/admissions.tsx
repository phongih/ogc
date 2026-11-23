// Admissions on the Platform: the shared view (features/admissions) over the Platform API, with
// Billing's "Issue first invoice"; "Refer to partner" arrives with the Partner slice.
import { useMemo, type ReactNode } from "react";
import { AdmissionsApiContext, type AdmissionsApi } from "../features/admissions/admissionsApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";
import { PolicyBanner, useMyPlatformAccess } from "./workforce";
import { PlatformLeadActions } from "./billing";

function useCanManage(): boolean {
  const q = useMyPlatformAccess();
  return q.data ? q.data.allowed.includes("admissions:manage") : true;
}

export function PlatformAdmissionsApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<AdmissionsApi>(
    () => ({
      key: ["admissions", s.principalId],
      subtitle: "Pipeline · lead score · funnel · staging",
      back: null,
      Banner: PolicyBanner,
      LeadActions: PlatformLeadActions,
      billingLink: "/billing",
      useCanManage,
      options: () => platformApi.admissionsOptions(s),
      listLeads: () => platformApi.leads(s),
      counselors: () => platformApi.counselors(s),
      createLead: (d) => platformApi.createLead(s, d),
      assign: (id, who) => platformApi.assignLead(s, id, who),
      moveStage: (id, stage, reason) => platformApi.moveLead(s, id, stage, reason),
      logActivity: (id, kind, text) => platformApi.logLeadActivity(s, id, kind, text),
      getDashboard: () => platformApi.admissionsDashboard(s),
      getSettings: () => platformApi.admissionsSettings(s),
      updateSettings: (next) => platformApi.updateAdmissionsSettings(s, next),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <AdmissionsApiContext.Provider value={api}>{children}</AdmissionsApiContext.Provider>;
}
