// Teachers and staff: Course Studio — courses OGC writes itself, reviewed by another person and
// published as immutable versions (owner 22/11 + 23/11), on the API. Synthetic courses.
import { useQuery } from "@tanstack/react-query";
import { CourseLibrary } from "../../features/studio/CourseLibrary";
import { CourseEditorView } from "../../features/studio/CourseEditorView";
import { useCourseStudioApi } from "../../features/studio/courseStudioApi";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { PlatformCourseStudioApi } from "../courses";
import { PolicyBanner } from "../workforce";

function Library() {
  const api = useCourseStudioApi();
  const q = useQuery({ queryKey: [...api.key, "list"], queryFn: () => api.list() });
  return (
    <section className="space-y-4">
      <PageHeader
        title="Course Studio"
        subtitle="Lessons of blocks · a different person approves · published versions never change · staging"
      />
      <PolicyBanner />
      {q.isLoading ? <Spinner label="Loading courses" /> : null}
      {q.isError ? (
        <ErrorState message="Could not load the courses." onRetry={() => q.refetch()} />
      ) : null}
      {q.data === null ? (
        <EmptyState title="Not available" hint="Teachers and center staff write courses." />
      ) : null}
      <CourseLibrary base="/courses" />
    </section>
  );
}

export function PlatformCoursesPage() {
  return (
    <PlatformCourseStudioApi>
      <Library />
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
