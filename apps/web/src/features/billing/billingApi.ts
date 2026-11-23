/*
 * The Billing screens are shared by the demo and the Platform (owner, 23/11). They call these
 * interfaces, never an adapter: the demo provides its mock (demoBillingApi.tsx), the Platform its
 * API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  BillingResult,
  FeeLine,
  FeeLineDraft,
  Invoice,
  MyBilling,
  Payment,
  PaymentMethod,
  Receivables,
} from "@ogc/contracts";

export interface BillingOptions {
  centers: { id: string; name: string }[]; // where the caller may bill
  courseCodes: string[];
  allCenters: boolean; // may propose a line for every center
}
export type Period = { year: string; period: string; from: string; to: string; current: boolean };

export interface BillingApi {
  key: readonly unknown[];
  subtitle: string;
  note: string;
  back: { to: string; label: string } | null;
  Banner: ComponentType | null;
  /** Hooks (UI hints; the server decides). */
  useCanManage(): boolean;
  useIsOrgAdmin(): boolean;
  options(): Promise<BillingOptions | null>;
  years(): Promise<string[] | null>;
  listFeeLines(year: string): Promise<FeeLine[] | null>;
  proposeFeeLine(draft: FeeLineDraft): Promise<BillingResult>;
  approveFeeLine(id: string): Promise<BillingResult>;
  rejectFeeLine(id: string, note: string): Promise<BillingResult>;
  retireFeeLine(id: string, note: string): Promise<BillingResult>;
  periods(): Promise<Period[] | null>;
  generateInvoices(
    year: string,
    period: string,
  ): Promise<BillingResult<{ created: number; existing: number; skippedNoLine: string[] }>>;
  listInvoices(): Promise<Invoice[] | null>;
  recordPayment(
    invoiceId: string,
    amountVnd: number,
    method: PaymentMethod,
  ): Promise<BillingResult<{ receiptNo: string }>>;
  voidInvoice(invoiceId: string, reason: string): Promise<BillingResult>;
  listPayments(): Promise<Payment[] | null>;
  getReceivables(): Promise<Receivables | null>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const BillingApiContext = createContext<BillingApi | null>(null);
export function useBillingApi(): BillingApi {
  const api = useContext(BillingApiContext);
  if (!api) throw new Error("BillingApiContext is not provided");
  return api;
}

/** A guardian's (or a learner who pays their own) invoices, read-only. */
export interface TuitionApi {
  key: readonly unknown[];
  subtitle: string;
  note: string;
  showWallet: boolean; // referral credit (demo only until the Growth slice)
  getMine(): Promise<MyBilling | null>;
}
export const TuitionApiContext = createContext<TuitionApi | null>(null);
export function useTuitionApi(): TuitionApi {
  const api = useContext(TuitionApiContext);
  if (!api) throw new Error("TuitionApiContext is not provided");
  return api;
}
