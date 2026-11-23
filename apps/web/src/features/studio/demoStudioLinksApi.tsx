// The demo's class courses: the shared screens over the mock adapter (SYNTHETIC, in the browser).
import { useMemo, type ReactNode } from "react";
import { studio } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { AccessBanner } from "../access/AccessBanner";
import { StudioLinksApiContext, type StudioLinksApi } from "./studioLinksApi";

export function DemoStudioLinksApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<StudioLinksApi>(
    () => ({
      key: ["studio", viewer],
      note: "synthetic demo",
      Banner: AccessBanner,
      getOverview: () => studio.getOverview(viewer),
      searchCourses: (q) => studio.searchCourses(viewer, q),
      propose: (classId, ref) => studio.propose(viewer, classId, ref),
      link: (classId, ref, h) => studio.link(viewer, classId, ref, h),
      reject: (id, reason) => studio.reject(viewer, id, reason),
      unlink: (id, reason) => studio.unlink(viewer, id, reason),
      setPrepHours: (id, h) => studio.setPrepHours(viewer, id, h),
      progress: (id) => studio.progress(viewer, id),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <StudioLinksApiContext.Provider value={api}>{children}</StudioLinksApiContext.Provider>;
}
