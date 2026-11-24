// The demo's class course in My Learning: the shared screens over the mock adapter (SYNTHETIC).
import { useMemo, type ReactNode } from "react";
import { classCourses } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { ClassCoursePlayerApiContext, type ClassCoursePlayerApi } from "./classCoursePlayerApi";

export function DemoClassCoursePlayerApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<ClassCoursePlayerApi>(
    () => ({
      key: ["class-courses", viewer],
      home: { to: "/app/learning", label: "My Learning" },
      lessonPath: (ref, id) => `/app/learning/class-courses/${ref}/${id}`,
      scoreNote: "counts in your skill profile",
      mine: () => classCourses.mine(viewer),
      lesson: (ref, id) => classCourses.lesson(viewer, ref, id),
      complete: (ref, id, a, r, sp, pr, m) =>
        classCourses.complete(viewer, ref, id, a, r, sp, pr, m),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
  return (
    <ClassCoursePlayerApiContext.Provider value={api}>
      {children}
    </ClassCoursePlayerApiContext.Provider>
  );
}
