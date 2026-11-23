// The demo's Decision Engine: the shared screens over the mock runner (SYNTHETIC, in the browser).
import { useMemo, type ReactNode } from "react";
import { decisionEngine } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import {
  EngineApiContext,
  NotificationsApiContext,
  type EngineApi,
  type NotificationsApi,
} from "./engineApi";

function useDemoAccess() {
  const me = useMyAccess();
  return {
    canManage: me.data?.allowed["engine:manage"] ?? true,
    actionsLocked: !!me.data?.readonly["engine:manage"]?.includes("actions"),
  };
}

export function DemoEngineApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<EngineApi>(
    () => ({
      key: ["engine", viewer],
      note: "synthetic demo",
      jobNote: "mock — no background server",
      Banner: AccessBanner,
      back: { to: "/app/operations", label: "Center operations" },
      useAccess: useDemoAccess,
      listRules: () => decisionEngine.listRules(viewer),
      updateRule: (id, patch) => decisionEngine.updateRule(viewer, id, patch),
      runNow: () => decisionEngine.runNow(viewer),
      listEvents: () => decisionEngine.listEvents(viewer),
      listActions: () => decisionEngine.listActions(viewer),
      getJobStatus: () => decisionEngine.getJobStatus(viewer),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <EngineApiContext.Provider value={api}>{children}</EngineApiContext.Provider>;
}

export function DemoNotificationsApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<NotificationsApi>(
    () => ({
      key: ["engine-inbox", viewer],
      list: () => decisionEngine.listNotifications(viewer),
      markRead: (id) => decisionEngine.markRead(viewer, id),
    }),
    [viewer],
  );
  return (
    <NotificationsApiContext.Provider value={api}>{children}</NotificationsApiContext.Provider>
  );
}
