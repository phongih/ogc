/*
 * The demo's Rewards page: the shared view (features/rewards) over the mock adapter.
 */
import { RewardsSettingsView } from "../rewards/RewardsSettingsView";
import { DemoRewardsAdminApi } from "../rewards/demoRewardsApi";

export function RewardsSettingsPage() {
  return (
    <DemoRewardsAdminApi>
      <RewardsSettingsView />
    </DemoRewardsAdminApi>
  );
}
