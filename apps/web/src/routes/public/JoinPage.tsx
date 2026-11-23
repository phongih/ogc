// Demo: the public /join landing over the mock adapter (shared view: features/growth/JoinView).
import { DemoJoinApi } from "../../features/growth/demoGrowthApi";
import { JoinView } from "../../features/growth/JoinView";

export function JoinPage() {
  return (
    <main id="main">
      <DemoJoinApi>
        <JoinView />
      </DemoJoinApi>
    </main>
  );
}
