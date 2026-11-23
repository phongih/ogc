// Course Studio on the Platform: the shared screens (features/studio, features/learner) over the
// Platform API — authoring, class links (prep hours count in Workforce) and My Learning. Synthetic.
import { useMemo, type ReactNode } from "react";
import { CourseStudioApiContext, type CourseStudioApi } from "../features/studio/courseStudioApi";
import { StudioLinksApiContext, type StudioLinksApi } from "../features/studio/studioLinksApi";
import {
  ClassCoursePlayerApiContext,
  type ClassCoursePlayerApi,
} from "../features/learner/classCoursePlayerApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";
import { PolicyBanner } from "./workforce";

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

export function PlatformStudioLinksApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<StudioLinksApi>(
    () => ({
      key: ["class-courses", s.principalId],
      note: "staging",
      Banner: PolicyBanner,
      getOverview: () => platformApi.classCourses(s),
      searchCourses: (q) => platformApi.searchClassCourses(s, q),
      propose: (classId, ref) => platformApi.proposeClassCourse(s, classId, ref),
      link: (classId, ref, h) => platformApi.linkClassCourse(s, classId, ref, h),
      reject: (id, reason) => platformApi.classCourseStep(s, id, "reject", { reason }),
      unlink: (id, reason) => platformApi.classCourseStep(s, id, "unlink", { reason }),
      setPrepHours: (id, hours) => platformApi.classCourseStep(s, id, "prep", { hours }),
      progress: (id) => platformApi.classCourseProgress(s, id),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <StudioLinksApiContext.Provider value={api}>{children}</StudioLinksApiContext.Provider>;
}

export function PlatformClassCoursePlayerApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<ClassCoursePlayerApi>(
    () => ({
      key: ["my-class-courses", s.principalId],
      home: { to: "/my-courses", label: "My courses" },
      lessonPath: (ref, id) => `/my-courses/${encodeURIComponent(ref)}/${encodeURIComponent(id)}`,
      scoreNote: null, // no skill profile on the Platform yet
      mine: () => platformApi.myClassCourses(s),
      lesson: (ref, id) => platformApi.myClassLesson(s, ref, id),
      complete: (ref, id, a, r) => platformApi.completeClassLesson(s, ref, id, a, r),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return (
    <ClassCoursePlayerApiContext.Provider value={api}>
      {children}
    </ClassCoursePlayerApiContext.Provider>
  );
}
