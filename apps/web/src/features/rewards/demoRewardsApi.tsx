/*
 * The demo's Rewards providers: the shared views over the mock adapter (browser memory,
 * synthetic). Not imported by the Platform bundle.
 */
import { useMemo, type ReactNode } from "react";
import { gamification } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import {
  RewardsAdminApiContext,
  RewardsApiContext,
  type RewardsAdminApi,
  type RewardsApi,
} from "./rewardsApi";

function useDemoCanManage(): boolean {
  return useMyAccess().data?.allowed["rewards:manage"] ?? true;
}

export function DemoRewardsApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<RewardsApi>(
    () => ({ key: ["gamification", viewer], mine: () => gamification.getMine(viewer) }),
    [viewer],
  );
  return <RewardsApiContext.Provider value={api}>{children}</RewardsApiContext.Provider>;
}

export function DemoRewardsAdminApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<RewardsAdminApi>(
    () => ({
      key: ["gamification-settings", viewer],
      subtitle: "Gamification · synthetic demo",
      back: { to: "/app/operations", label: "Center operations" },
      Banner: AccessBanner,
      useCanManage: useDemoCanManage,
      settings: () => gamification.getSettings(viewer),
      update: (patch) => gamification.updateSettings(viewer, patch),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <RewardsAdminApiContext.Provider value={api}>{children}</RewardsAdminApiContext.Provider>;
}
