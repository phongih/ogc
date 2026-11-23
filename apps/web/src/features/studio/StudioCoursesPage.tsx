// The demo's Course Studio page: the shared screens (StudioCoursesView) over the mock adapters.
import { StudioCoursesView } from "./StudioCoursesView";
import { DemoCourseStudioApi } from "./demoCourseStudioApi";
import { DemoStudioLinksApi } from "./demoStudioLinksApi";

export function StudioCoursesPage({
  back,
  base,
}: {
  back: { to: string; label: string };
  base: string;
}) {
  return (
    <DemoCourseStudioApi>
      <DemoStudioLinksApi>
        <StudioCoursesView back={back} base={base} />
      </DemoStudioLinksApi>
    </DemoCourseStudioApi>
  );
}
