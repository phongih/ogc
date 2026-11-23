// The demo's Course Studio: the shared screens over the mock adapter (SYNTHETIC, in the browser).
import { useMemo, type ReactNode } from "react";
import { courseStudio } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { CourseStudioApiContext, type CourseStudioApi } from "./courseStudioApi";

export function DemoCourseStudioApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<CourseStudioApi>(
    () => ({
      key: ["course-studio", viewer],
      note: "synthetic demo",
      list: () => courseStudio.list(viewer),
      get: (ref) => courseStudio.get(viewer, ref),
      create: (title, level) => courseStudio.create(viewer, title, level),
      saveDraft: (ref, content, rev) => courseStudio.saveDraft(viewer, ref, content, rev),
      submit: (ref) => courseStudio.submit(viewer, ref),
      withdraw: (ref) => courseStudio.withdraw(viewer, ref),
      approve: (ref, note) => courseStudio.approve(viewer, ref, note),
      returnForChanges: (ref, note) => courseStudio.returnForChanges(viewer, ref, note),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return <CourseStudioApiContext.Provider value={api}>{children}</CourseStudioApiContext.Provider>;
}
