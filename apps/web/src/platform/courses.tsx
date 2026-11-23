// Course Studio on the Platform: the shared screens (features/studio) over the Platform API.
// Synthetic courses; part B links them to classes and adds My Learning.
import { useMemo, type ReactNode } from "react";
import { CourseStudioApiContext, type CourseStudioApi } from "../features/studio/courseStudioApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";

export function PlatformCourseStudioApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<CourseStudioApi>(
    () => ({
      key: ["course-studio", s.principalId],
      note: "staging · synthetic",
      list: () => platformApi.courses(s),
      get: (ref) => platformApi.course(s, ref),
      create: (title, level) => platformApi.createCourse(s, title, level),
      saveDraft: (ref, content, rev) => platformApi.saveCourseDraft(s, ref, content, rev),
      submit: (ref) => platformApi.courseStep(s, ref, "submit"),
      withdraw: (ref) => platformApi.courseStep(s, ref, "withdraw"),
      approve: (ref, note) => platformApi.courseStep(s, ref, "approve", note),
      returnForChanges: (ref, note) => platformApi.courseStep(s, ref, "return", note),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <CourseStudioApiContext.Provider value={api}>{children}</CourseStudioApiContext.Provider>;
}
