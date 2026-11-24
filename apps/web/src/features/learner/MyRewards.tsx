/*
 * The demo's rewards card: the shared view (features/rewards) over the mock adapter.
 */
import { MyRewardsView } from "../rewards/RewardsCard";
import { DemoRewardsApi } from "../rewards/demoRewardsApi";

export function MyRewards(props: { learnerId?: string; guardian?: boolean }) {
  return (
    <DemoRewardsApi>
      <MyRewardsView {...props} />
    </DemoRewardsApi>
  );
}
