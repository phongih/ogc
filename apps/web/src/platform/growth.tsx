// Growth · referrals on the Platform (owner 23/11, slice 6): the shared views (features/growth)
// over the Platform API. Synthetic: no credit is charged or paid for real.
import { useMemo, type ReactNode } from "react";
import {
  GrowthAdminApiContext,
  JoinApiContext,
  ReferralsApiContext,
  type GrowthAdminApi,
  type JoinApi,
  type ReferralsApi,
} from "../features/growth/growthApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";
import { PolicyBanner, useMyPlatformAccess } from "./workforce";

function useCanManage(): boolean {
  const q = useMyPlatformAccess();
  return q.data ? q.data.allowed.includes("growth:manage") : true;
}

export function PlatformReferralsApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<ReferralsApi>(
    () => ({
      key: ["referrals", s.principalId],
      subtitle: "Referral program · staging, synthetic data",
      mine: () => platformApi.myReferrals(s),
    }),
    [s],
  );
  return <ReferralsApiContext.Provider value={api}>{children}</ReferralsApiContext.Provider>;
}

export function PlatformGrowthAdminApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<GrowthAdminApi>(
    () => ({
      key: ["growth", s.principalId],
      subtitle: "Referral program · staging, synthetic data",
      back: null,
      admissionsPath: "/admissions",
      Banner: PolicyBanner,
      useCanManage,
      leads: () => platformApi.referralLeads(s),
      confirm: (id) => platformApi.decideReferral(s, id, "confirm"),
      reject: (id, reason) => platformApi.decideReferral(s, id, "reject", reason),
      program: () => platformApi.referralProgram(s),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <GrowthAdminApiContext.Provider value={api}>{children}</GrowthAdminApiContext.Provider>;
}

const platformJoin: JoinApi = {
  note: "Staging, synthetic data: no message is sent.",
  home: { to: "/login", label: "OGC Platform" },
  recordClick: (code) => platformApi.joinInfo(code),
  submitLead: (code, input) => platformApi.joinLead(code, input),
};
export function PlatformJoinApi({ children }: { children: ReactNode }) {
  return <JoinApiContext.Provider value={platformJoin}>{children}</JoinApiContext.Provider>;
}
