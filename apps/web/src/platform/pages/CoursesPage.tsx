// Teachers and staff: Course Studio — courses OGC writes itself (a different person approves,
// published versions never change) and the course each class follows (the class teacher proposes,
// staff link with weekly prep hours that count in Workforce). Learners: My courses — the linked
// course, on the version they started. Owner 22/11 + 23/11, on the API. Synthetic courses.
import { CourseEditorView } from "../../features/studio/CourseEditorView";
import { StudioCoursesView } from "../../features/studio/StudioCoursesView";
import { ClassLessonView, MyClassCoursesView } from "../../features/learner/ClassCoursesView";
import { EmptyState, PageHeader } from "../../ui";
import { useQuery } from "@tanstack/react-query";
import { useClassCoursePlayerApi } from "../../features/learner/classCoursePlayerApi";
import {
  PlatformClassCoursePlayerApi,
  PlatformCourseStudioApi,
  PlatformStudioLinksApi,
} from "../courses";
import { PolicyBanner } from "../workforce";

export function PlatformCoursesPage() {
  return (
    <PlatformCourseStudioApi>
      <PlatformStudioLinksApi>
        <StudioCoursesView back={null} base="/courses" />
      </PlatformStudioLinksApi>
    </PlatformCourseStudioApi>
  );
}

export function PlatformCoursePage() {
  return (
    <PlatformCourseStudioApi>
      <PolicyBanner />
      <CourseEditorView base="/courses" />
    </PlatformCourseStudioApi>
  );
}

function MyCourses() {
  const api = useClassCoursePlayerApi();
  const q = useQuery({ queryKey: [...api.key, "mine"], queryFn: () => api.mine() });
  return (
    <section className="space-y-4">
      <PageHeader title="My courses" subtitle="The course your class follows · staging" />
      {q.data === null ? <EmptyState title="Not available" hint="For learners." /> : null}
      {q.data && q.data.length === 0 ? (
        <EmptyState title="No class course yet" hint="Your class does not follow a course yet." />
      ) : null}
      <MyClassCoursesView />
    </section>
  );
}

export function PlatformMyCoursesPage() {
  return (
    <PlatformClassCoursePlayerApi>
      <MyCourses />
    </PlatformClassCoursePlayerApi>
  );
}

export function PlatformClassLessonPage() {
  return (
    <PlatformClassCoursePlayerApi>
      <ClassLessonView />
    </PlatformClassCoursePlayerApi>
  );
}
