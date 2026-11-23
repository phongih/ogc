/*
 * Growth · referrals is shared by the demo and the Platform (owner 23/11, slice 6). The screens call
 * these interfaces, never an adapter: the demo provides its mock (demoGrowthApi.tsx), the Platform
 * its API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  GrowthMetrics,
  GrowthResult,
  MyReferrals,
  ReferralLead,
  ReferralProgram,
} from "@ogc/contracts";

/** A guardian's or adult learner's own referral page. */
export interface ReferralsApi {
  key: readonly unknown[];
  subtitle: string;
  mine(): Promise<MyReferrals | null>;
}

/** Center staff: the funnel (and, where offered, metrics and program settings). */
export interface GrowthAdminApi {
  key: readonly unknown[];
  subtitle: string;
  back: { to: string; label: string } | null;
  admissionsPath: string;
  Banner: ComponentType;
  /** UI hint only — the server decides (growth:manage). */
  useCanManage(): boolean;
  metrics?: () => Promise<GrowthMetrics | null>;
  leads(): Promise<ReferralLead[] | null>;
  confirm(leadId: string): Promise<GrowthResult>;
  reject(leadId: string, reason: string): Promise<GrowthResult>;
  program(): Promise<ReferralProgram | null>;
  updateProgram?: (p: ReferralProgram) => Promise<GrowthResult>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export interface JoinInfo {
  valid: boolean;
  centerNames: string[];
  courses: { code: string; title: string }[];
}
export type JoinResult = { ok: true } | { ok: false; reason: string; detail?: string };

/** The public /join page (no sign-in). */
export interface JoinApi {
  note: string;
  home: { to: string; label: string };
  recordClick(code: string): Promise<JoinInfo>;
  submitLead(
    code: string,
    input: {
      learnerName: string;
      courseCode: string;
      centerName: string;
      campaignId: string | null;
    },
  ): Promise<JoinResult>;
}

export const ReferralsApiContext = createContext<ReferralsApi | null>(null);
export const GrowthAdminApiContext = createContext<GrowthAdminApi | null>(null);
export const JoinApiContext = createContext<JoinApi | null>(null);

function use<T>(c: React.Context<T | null>, name: string): T {
  const v = useContext(c);
  if (!v) throw new Error(`${name} is not provided`);
  return v;
}
export const useReferralsApi = () => use(ReferralsApiContext, "ReferralsApiContext");
export const useGrowthAdminApi = () => use(GrowthAdminApiContext, "GrowthAdminApiContext");
export const useJoinApi = () => use(JoinApiContext, "JoinApiContext");
