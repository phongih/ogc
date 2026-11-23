/*
 * The Partner Commissions screens are shared by the demo and the Platform (owner, 23/11). They call
 * these interfaces, never an adapter: the demo provides its mock (demoPartnersApi.tsx), the Platform
 * its API client — the Platform bundle stays free of mocks. Settlements, report import and trends
 * come in through `Slice2` (absent on the Platform until that PR).
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ActivityEntry,
  CommissionEntry,
  Partner,
  PartnerFit,
  PartnersOverview,
  PartnersResult,
  TierRuleDraft,
} from "@ogc/contracts";

export interface PartnersSlice2 {
  Settlements: ComponentType<{ isAdmin: boolean }>;
  ImportReport: ComponentType;
  Trends: ComponentType;
}

export interface PartnersApi {
  key: readonly unknown[];
  subtitle: string;
  back: { to: string; label: string } | null;
  Banner: ComponentType | null;
  Slice2: PartnersSlice2 | null;
  getOverview(): Promise<PartnersOverview | null>;
  listPartners(): Promise<Partner[] | null>;
  listEntries(): Promise<CommissionEntry[] | null>;
  listActivity(): Promise<ActivityEntry[] | null>;
  markEnrolled(entryId: string): Promise<PartnersResult>;
  reject(entryId: string, reason: string): Promise<PartnersResult>;
  approve(entryId: string): Promise<PartnersResult>;
  proposeRule(partnerId: string, draft: TierRuleDraft): Promise<PartnersResult>;
  decideRule(ruleId: string, decision: "activate" | "reject"): Promise<PartnersResult>;
  actOnSignal(
    signalId: string,
    action: "follow" | "snooze" | "dismiss",
    note?: string,
  ): Promise<PartnersResult>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const PartnersApiContext = createContext<PartnersApi | null>(null);
export function usePartnersApi(): PartnersApi {
  const api = useContext(PartnersApiContext);
  if (!api) throw new Error("PartnersApiContext is not provided");
  return api;
}

/** Admissions → "Refer to partner": suggestions for one lead, and the referral. */
export interface ReferApi {
  key: readonly unknown[];
  suggest(leadId: string): Promise<PartnerFit[] | null>;
  refer(leadId: string, partnerId: string): Promise<PartnersResult>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}
