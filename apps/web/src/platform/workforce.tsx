// Workforce on the Platform: the shared views (features/workforce) over the Platform API.
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkforceApiContext, type WorkforceApi } from "../features/workforce/workforceApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";

/** The caller's own access as IIOS decided it (UI hints only — the API enforces). */
export function useMyPlatformAccess() {
  const s = useSignedIn();
  return useQuery({
    queryKey: ["me-access", s.principalId],
    queryFn: () => platformApi.myAccess(s),
  });
}

/** "Limited by access policy: <name>" when IIOS narrowed the caller. */
export function PolicyBanner() {
  const q = useMyPlatformAccess();
  const n = q.data?.narrowing;
  if (!n || n.state === "none") return null;
  return (
    <p role="note" className="rounded-ogc border border-border bg-surface p-2 text-sm text-muted">
      {n.state === "policy"
        ? `Limited by access policy: ${n.name ?? "a policy"}`
        : "Your access policy could not be resolved — nothing is allowed until IIOS can."}
    </p>
  );
}

function useCanManage(): boolean {
  const q = useMyPlatformAccess();
  return q.data ? q.data.allowed.includes("workforce:manage") : true;
}

export function PlatformWorkforceApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<WorkforceApi>(
    () => ({
      key: ["workforce", s.principalId],
      subtitle: "Teacher load · staging",
      back: null,
      Banner: PolicyBanner,
      useCanManage,
      getOverview: () => platformApi.workforce(s),
      setTarget: (t, e, h) => platformApi.setTarget(s, t, e, h),
      updateSettings: (next) => platformApi.updateWorkforceSettings(s, next),
      suggest: (target) =>
        "classId" in target
          ? platformApi.suggestForClass(s, target.classId)
          : "sessionId" in target
            ? platformApi.suggestForSession(s, target.sessionId)
            : Promise.resolve(null), // no new-center wizard on the Platform yet
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <WorkforceApiContext.Provider value={api}>{children}</WorkforceApiContext.Provider>;
}
