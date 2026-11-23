/*
 * The demo's Growth providers: the shared views over the mock adapter (browser memory, synthetic).
 * Not imported by the Platform bundle.
 */
import { useMemo, type ReactNode } from "react";
import { growth } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { saveDemoState } from "../../lib/adapters/persist";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import {
  GrowthAdminApiContext,
  JoinApiContext,
  ReferralsApiContext,
  type GrowthAdminApi,
  type JoinApi,
  type ReferralsApi,
} from "./growthApi";

function useDemoCanManage(): boolean {
  return useMyAccess().data?.allowed["growth:manage"] ?? true;
}

export function DemoReferralsApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<ReferralsApi>(
    () => ({
      key: ["growth-mine", viewer],
      subtitle: "Referral program · synthetic demo",
      mine: () => growth.getMine(viewer),
    }),
    [viewer],
  );
  return <ReferralsApiContext.Provider value={api}>{children}</ReferralsApiContext.Provider>;
}

export function DemoGrowthAdminApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<GrowthAdminApi>(
    () => ({
      key: ["growth", viewer],
      subtitle: "Referral program · synthetic demo",
      back: { to: "/app/operations", label: "Center operations" },
      admissionsPath: "/app/operations/admissions",
      Banner: AccessBanner,
      useCanManage: useDemoCanManage,
      metrics: () => growth.getMetrics(viewer),
      leads: () => growth.listLeads(viewer),
      confirm: (id) => growth.confirm(viewer, id),
      reject: (id, reason) => growth.reject(viewer, id, reason),
      program: () => growth.getProgram(viewer),
      updateProgram: (p) => growth.updateProgram(viewer, p),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <GrowthAdminApiContext.Provider value={api}>{children}</GrowthAdminApiContext.Provider>;
}

const demoJoin: JoinApi = {
  note: "Synthetic demo: no message is sent.",
  home: { to: "/", label: "OGC Learning" },
  recordClick: async (code) => {
    const i = await growth.recordClick(code);
    saveDemoState(); // other open tabs (e.g. staff's Funnel) pick it up at once
    return i;
  },
  submitLead: async (code, input) => {
    const r = await growth.submitLead(code, input);
    if (r.ok) saveDemoState(); // save now — not only when this tab closes
    return r;
  },
};
export function DemoJoinApi({ children }: { children: ReactNode }) {
  return <JoinApiContext.Provider value={demoJoin}>{children}</JoinApiContext.Provider>;
}
