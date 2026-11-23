// The demo's Current Students page: the shared screen (StudentsView) over the mock adapter.
import { StudentsView } from "./StudentsView";
import { DemoStudentsApi } from "./demoStudentsApi";

export { CARE_LABEL } from "./StudentsView";

export function StudentsPage({ back }: { back: { to: string; label: string } }) {
  return (
    <DemoStudentsApi>
      <StudentsView back={back} />
    </DemoStudentsApi>
  );
}
