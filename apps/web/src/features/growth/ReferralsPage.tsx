// Demo: Refer a friend over the mock adapter (shared view: ReferralsView).
import { DemoReferralsApi } from "./demoGrowthApi";
import { ReferralsView } from "./ReferralsView";

export function ReferralsPage() {
  return (
    <DemoReferralsApi>
      <ReferralsView />
    </DemoReferralsApi>
  );
}
