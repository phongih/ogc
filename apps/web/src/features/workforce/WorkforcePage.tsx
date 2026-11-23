// Demo: the shared Workforce page over the in-browser mock (see WorkforceView.tsx).
import { DemoWorkforceApi } from "./demoWorkforceApi";
import { WorkforceView } from "./WorkforceView";

export function WorkforcePage() {
  return (
    <DemoWorkforceApi>
      <WorkforceView />
    </DemoWorkforceApi>
  );
}
