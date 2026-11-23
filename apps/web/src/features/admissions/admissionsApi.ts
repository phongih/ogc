/*
 * The Admissions screens are shared by the demo and the Platform (owner, 23/11). They call this
 * interface, never an adapter: the demo provides its mock (demoAdmissionsApi.tsx), the Platform its
 * API client — the Platform bundle stays free of mocks. Actions that belong to other slices
 * (first invoice → Billing, refer → Partner Commissions) come in through `LeadActions`, absent on
 * the Platform until those slices are there.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AdmissionsDashboard,
  AdmissionsResult,
  Lead,
  LeadActivityKind,
  LeadDraft,
  LeadStage,
  ScoringSettings,
} from "@ogc/contracts";

export interface AdmissionsOptions {
  centers: { id: string; name: string }[]; // where the caller may add leads
  courseCodes: string[];
}

export interface AdmissionsApi {
  key: readonly unknown[];
  subtitle: string;
  back: { to: string; label: string } | null;
  Banner: ComponentType | null; // e.g. "limited by access policy"
  /** Extra actions on an open lead from other slices (Billing, Partners), or none. */
  LeadActions: ComponentType<{ lead: Lead }> | null;
  billingLink: string | null;
  /** Hook: may the caller tune the score (UI hint; the server decides). */
  useCanManage(): boolean;
  options(): Promise<AdmissionsOptions | null>;
  listLeads(): Promise<Lead[] | null>;
  counselors(): Promise<{ principalId: string; name: string }[] | null>;
  createLead(draft: LeadDraft): Promise<AdmissionsResult>;
  assign(leadId: string, principalId: string): Promise<AdmissionsResult>;
  moveStage(leadId: string, stage: LeadStage, reason?: string): Promise<AdmissionsResult>;
  logActivity(leadId: string, kind: LeadActivityKind, text: string): Promise<AdmissionsResult>;
  getDashboard(): Promise<AdmissionsDashboard | null>;
  getSettings(): Promise<ScoringSettings | null>;
  updateSettings(next: ScoringSettings): Promise<AdmissionsResult>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const AdmissionsApiContext = createContext<AdmissionsApi | null>(null);

export function useAdmissionsApi(): AdmissionsApi {
  const api = useContext(AdmissionsApiContext);
  if (!api) throw new Error("AdmissionsApiContext is not provided");
  return api;
}
