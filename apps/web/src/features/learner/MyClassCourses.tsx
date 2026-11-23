// The demo's "Your class course" on My Learning: the shared view over the mock adapter.
import { MyClassCoursesView } from "./ClassCoursesView";
import { DemoClassCoursePlayerApi } from "./demoClassCoursePlayerApi";

export function MyClassCourses() {
  return (
    <DemoClassCoursePlayerApi>
      <MyClassCoursesView />
    </DemoClassCoursePlayerApi>
  );
}
