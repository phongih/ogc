// The demo's Tuition page: the shared view over the in-browser mock.
import { DemoTuitionApi } from "./demoBillingApi";
import { TuitionView } from "./TuitionView";

export function TuitionPage() {
  return (
    <DemoTuitionApi>
      <TuitionView />
    </DemoTuitionApi>
  );
}
