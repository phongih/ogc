/*
 * Gamification is shared by the demo and the Platform (owner 24/11). The screens call these
 * interfaces, never an adapter: the demo provides its mock (demoRewardsApi.tsx), the Platform its
 * API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  GamificationSettings,
  GamificationUpdate,
  GamificationUpdateResult,
  LearnerGamification,
} from "@ogc/contracts";

/** A learner's own rewards, or a guardian's linked children's. */
export interface RewardsApi {
  key: readonly unknown[];
  mine(): Promise<LearnerGamification[]>;
}

/** Center staff: the closed catalog (staff with rewards:manage change it). */
export interface RewardsAdminApi {
  key: readonly unknown[];
  subtitle: string;
  back: { to: string; label: string } | null;
  Banner: ComponentType;
  /** UI hint only — the server decides (rewards:manage). */
  useCanManage(): boolean;
  settings(): Promise<GamificationSettings | null>;
  update(patch: GamificationUpdate): Promise<GamificationUpdateResult>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const RewardsApiContext = createContext<RewardsApi | null>(null);
export const RewardsAdminApiContext = createContext<RewardsAdminApi | null>(null);

export function useRewardsApi(): RewardsApi {
  const a = useContext(RewardsApiContext);
  if (!a) throw new Error("RewardsApiContext is not provided");
  return a;
}
export function useRewardsAdminApi(): RewardsAdminApi {
  const a = useContext(RewardsAdminApiContext);
  if (!a) throw new Error("RewardsAdminApiContext is not provided");
  return a;
}
