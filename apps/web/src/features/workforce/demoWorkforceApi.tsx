// The demo's workforce API: the in-browser mock with the caller's granted context. Demo only.
import { useMemo, type ReactNode } from "react";
import { workforce } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import { WorkforceApiContext, type WorkforceApi } from "./workforceApi";

const useCanManage = () => useMyAccess().data?.allowed["workforce:manage"] ?? true;

export function DemoWorkforceApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<WorkforceApi>(
    () => ({
      key: ["workforce-demo", viewer],
      subtitle: "Teacher load · synthetic demo",
      back: { to: "/app/operations", label: "← Center operations" },
      Banner: AccessBanner,
      useCanManage,
      getOverview: () => workforce.getOverview(viewer),
      setTarget: (t, e, h) => workforce.setTarget(viewer, t, e, h),
      updateSettings: (s) => workforce.updateSettings(viewer, s),
      suggest: (target) =>
        "classId" in target
          ? workforce.suggestForClass(viewer, target.classId)
          : "sessionId" in target
            ? workforce.suggestForSession(viewer, target.sessionId)
            : workforce.suggestForNewClass(viewer, target.weeklyMinutes),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <WorkforceApiContext.Provider value={api}>{children}</WorkforceApiContext.Provider>;
}
