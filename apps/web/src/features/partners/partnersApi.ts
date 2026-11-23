/*
 * The Partner Commissions screens are shared by the demo and the Platform (owner, 23/11). They call
 * these interfaces, never an adapter: the demo provides its mock (demoPartnersApi.tsx), the Platform
 * its API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ActivityEntry,
  BatchCandidate,
  CommissionEntry,
  Partner,
  PartnerFit,
  PartnersOverview,
  PartnersResult,
  PartnerTrend,
  ReportRow,
  SettlementBatch,
  TierRuleDraft,
} from "@ogc/contracts";

export interface PartnersApi {
  key: readonly unknown[];
  subtitle: string;
  back: { to: string; label: string } | null;
  Banner: ComponentType | null;
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
  // settlement batches, partner reports, trends
  listBatches(): Promise<SettlementBatch[] | null>;
  batchCandidates(): Promise<BatchCandidate[] | null>;
  draftBatch(partnerId: string, cycleLabel: string): Promise<PartnersResult>;
  sendBatch(batchId: string): Promise<PartnersResult>;
  markBatchPaid(batchId: string, paymentRef: string): Promise<PartnersResult>;
  cancelBatch(batchId: string, reason: string): Promise<PartnersResult>;
  previewReport(partnerId: string, csv: string): Promise<ReportRow[] | null>;
  applyReportRow(
    partnerId: string,
    row: Pick<ReportRow, "leadRefCode" | "reported" | "date" | "reason">,
  ): Promise<PartnersResult>;
  getTrends(): Promise<PartnerTrend[] | null>;
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
