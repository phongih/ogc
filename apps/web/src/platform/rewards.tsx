// Gamification on the Platform (owner 24/11): the shared views (features/rewards) over the API.
// Rewards come only from learning evidence; learners and guardians see them; staff with
// rewards:manage tune the closed catalog. Synthetic data.
import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  RewardsAdminApiContext,
  RewardsApiContext,
  type RewardsAdminApi,
  type RewardsApi,
} from "../features/rewards/rewardsApi";
import { MyRewardsView, useMyRewards } from "../features/rewards/RewardsCard";
import { RewardsSettingsView } from "../features/rewards/RewardsSettingsView";
import { EmptyState, ErrorState, PageHeader, Spinner } from "../ui";
import { platformApi } from "./client";
import { useSignedIn } from "./App";
import { PolicyBanner, useMyPlatformAccess } from "./workforce";

function useCanManage(): boolean {
  const q = useMyPlatformAccess();
  return q.data ? q.data.allowed.includes("rewards:manage") : true;
}

export function PlatformRewardsApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<RewardsApi>(
    () => ({ key: ["rewards", s.principalId], mine: () => platformApi.myRewards(s) }),
    [s],
  );
  return <RewardsApiContext.Provider value={api}>{children}</RewardsApiContext.Provider>;
}

export function PlatformRewardsAdminApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<RewardsAdminApi>(
    () => ({
      key: ["rewards-settings", s.principalId],
      subtitle: "Gamification · staging, synthetic data",
      back: { to: "/engine", label: "Decision Engine" },
      Banner: PolicyBanner,
      useCanManage,
      settings: () => platformApi.rewardsSettings(s),
      update: (patch) => platformApi.updateRewardsSettings(s, patch),
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <RewardsAdminApiContext.Provider value={api}>{children}</RewardsAdminApiContext.Provider>;
}

function MyRewardsList() {
  const s = useSignedIn();
  const q = useMyRewards();
  if (q.isLoading) return <Spinner label="Loading rewards" />;
  if (q.isError)
    return <ErrorState message="Could not load rewards." onRetry={() => q.refetch()} />;
  if (!q.data?.length) return <EmptyState title="No rewards to show" />;
  const guardian = s.role === "guardian";
  return (
    <div className="space-y-6">
      {q.data.map((g) => (
        <MyRewardsView key={g.learnerId} learnerId={g.learnerId} guardian={guardian} />
      ))}
    </div>
  );
}

/** Learner: their rewards. Guardian: their child's (rank only). */
export function PlatformMyRewardsPage() {
  return (
    <section className="space-y-4">
      <PageHeader title="Rewards" subtitle="Staging, synthetic data" />
      <PlatformRewardsApi>
        <MyRewardsList />
      </PlatformRewardsApi>
    </section>
  );
}

/** Staff: the closed catalog. */
export function PlatformRewardsSettingsPage() {
  return (
    <PlatformRewardsAdminApi>
      <RewardsSettingsView />
    </PlatformRewardsAdminApi>
  );
}

export function RewardsLink() {
  return (
    <Link to="/rewards" className="text-sm text-brand underline">
      Rewards (gamification) settings →
    </Link>
  );
}
