// Decision Engine on the Platform: the shared screens (features/engine) over the Platform API.
// It runs when a page asks and the last run is older than 60 s (owner 23/11). Synthetic data.
import { useMemo, type ReactNode } from "react";
import {
  EngineApiContext,
  NotificationsApiContext,
  type EngineApi,
  type NotificationsApi,
} from "../features/engine/engineApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";
import { PolicyBanner, useMyPlatformAccess } from "./workforce";

/** UI hint: may the caller tune rules, and are rule actions read-only for them (the API decides). */
function usePlatformEngineAccess() {
  const q = useMyPlatformAccess();
  const n = q.data?.narrowing;
  const rules =
    n?.state === "policy" ? (n.rules ?? []).filter((r) => r.action === "engine:manage") : [];
  return {
    canManage: q.data ? q.data.allowed.includes("engine:manage") : true,
    actionsLocked: rules.length > 0 && rules.every((r) => r.readonlyFields?.includes("actions")),
  };
}

export function PlatformEngineApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<EngineApi>(
    () => ({
      key: ["engine", s.principalId],
      note: "staging",
      jobNote: "on the API, when a staff or teacher page asks — no background service",
      Banner: PolicyBanner,
      back: null,
      useAccess: usePlatformEngineAccess,
      listRules: () => platformApi.engineRules(s),
      updateRule: (id, patch) => platformApi.updateEngineRule(s, id, patch),
      runNow: () => platformApi.runEngine(s),
      listEvents: () => platformApi.engineEvents(s),
      listActions: () => platformApi.engineActions(s),
      getJobStatus: () => platformApi.engineJob(s),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <EngineApiContext.Provider value={api}>{children}</EngineApiContext.Provider>;
}

export function PlatformNotificationsApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<NotificationsApi>(
    () => ({
      key: ["notifications", s.principalId],
      list: () => platformApi.notifications(s),
      markRead: (id) => platformApi.markNotificationRead(s, id),
    }),
    [s],
  );
  return (
    <NotificationsApiContext.Provider value={api}>{children}</NotificationsApiContext.Provider>
  );
}
