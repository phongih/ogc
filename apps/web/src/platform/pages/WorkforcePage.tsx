// Staff: teaching hours in the next 7 days vs each teacher's target (owner, 22/11), on the API.
import { WorkforceView } from "../../features/workforce/WorkforceView";
import { PlatformWorkforceApi } from "../workforce";

export function PlatformWorkforcePage() {
  return (
    <PlatformWorkforceApi>
      <WorkforceView />
    </PlatformWorkforceApi>
  );
}
