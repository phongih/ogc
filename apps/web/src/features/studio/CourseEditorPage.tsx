// The demo's course page: the shared editor (CourseEditorView) over the mock adapter.
import { CourseEditorView } from "./CourseEditorView";
import { DemoCourseStudioApi } from "./demoCourseStudioApi";

export { AUTHORED_STATUS, Refused } from "./CourseEditorView";

export function CourseEditorPage({ base }: { base: string }) {
  return (
    <DemoCourseStudioApi>
      <CourseEditorView base={base} />
    </DemoCourseStudioApi>
  );
}
