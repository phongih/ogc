// The demo's class-course lesson page: the shared view over the mock adapter.
import { ClassLessonView } from "./ClassCoursesView";
import { DemoClassCoursePlayerApi } from "./demoClassCoursePlayerApi";

export function ClassLessonPage() {
  return (
    <DemoClassCoursePlayerApi>
      <ClassLessonView />
    </DemoClassCoursePlayerApi>
  );
}
