// Growth · referrals on the Platform: Refer a friend (guardians, adult learners), the staff funnel
// and the public /join page (no sign-in). Synthetic data.
import { ReferralsView } from "../../features/growth/ReferralsView";
import { GrowthAdminView } from "../../features/growth/GrowthAdminView";
import { JoinView } from "../../features/growth/JoinView";
import { PlatformGrowthAdminApi, PlatformJoinApi, PlatformReferralsApi } from "../growth";

export function PlatformReferralsPage() {
  return (
    <PlatformReferralsApi>
      <ReferralsView />
    </PlatformReferralsApi>
  );
}

export function PlatformGrowthPage() {
  return (
    <PlatformGrowthAdminApi>
      <GrowthAdminView />
    </PlatformGrowthAdminApi>
  );
}

export function PlatformJoinPage() {
  return (
    <PlatformJoinApi>
      <JoinView />
    </PlatformJoinApi>
  );
}
