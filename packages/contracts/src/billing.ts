import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Billing & payments — ADDITIVE, SYNTHETIC, mock only (pattern from EduOS Billing & Payments).
 * NOTHING is charged, paid, invoiced or sent for real: no payment gateway, no tax invoice, no
 * accounting export.
 *
 * Owner decisions (22/11):
 *  - slice 1 = fee plans per school year + invoices + recorded payments + receivables;
 *  - MAKER-CHECKER: center staff propose fee lines, an Org Admin approves them (never their own
 *    proposal); only APPROVED lines can be invoiced;
 *  - a referral moves to "enrolled and paid" when the new learner's FIRST INVOICE is paid — the
 *    amount comes from the invoice, staff no longer type it; a referrer's wallet credit is applied
 *    to their next invoice automatically;
 *  - an overdue invoice NEVER blocks learning or attendance (minors included): it shows in
 *    Receivables and the Decision Engine notifies staff.
 */

export type FeeKind = "tuition" | "materials";
export type FeeLineStatus = "pending" | "approved" | "rejected" | "retired";

export interface FeeLine {
  id: string;
  year: string; // "2026-2027"
  courseCode: string;
  centerId: string | null; // null = every center of the organization
  centerName: string; // "All centers" when centerId is null
  kind: FeeKind;
  period: string; // "Term 1"
  from: string; // YYYY-MM-DD (center time)
  to: string;
  dueDate: string; // YYYY-MM-DD
  amountVnd: number;
  status: FeeLineStatus;
  proposedBy: string; // display name
  proposedAt: string;
  decidedBy: string | null; // approver / rejecter / retirer
  decidedAt: string | null;
  note: string | null; // reject / retire reason
  mine: boolean; // proposed by the viewer (an Org Admin cannot approve it)
}

export interface FeeLineDraft {
  year: string;
  courseCode: string;
  centerId: string | null;
  kind: FeeKind;
  period: string;
  from: string;
  to: string;
  dueDate: string;
  amountVnd: number;
}

export type InvoiceStatus = "issued" | "partially_paid" | "paid" | "void";
export type PaymentMethod = "cash" | "bank_transfer" | "card";

export interface InvoiceLine {
  feeLineId: string;
  description: string; // "ENG-A2 · Tuition · Term 1 2026-2027"
  amountVnd: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  learnerName: string;
  at: string;
  amountVnd: number;
  method: PaymentMethod;
  receiptNo: string;
  recordedBy: string;
}

export interface Invoice {
  id: string;
  no: string; // "INV-2026-0001"
  centerId: string;
  centerName: string;
  learnerName: string;
  billTo: { kind: "learner"; learnerId: string } | { kind: "lead"; leadId: string };
  payerName: string | null; // guardian or adult learner with an account; null = pays at the desk
  lines: InvoiceLine[];
  subtotalVnd: number;
  creditAppliedVnd: number; // referral credit from the payer's wallet
  totalVnd: number; // subtotal − credit
  paidVnd: number;
  balanceVnd: number;
  status: InvoiceStatus;
  issuedAt: string;
  dueDate: string;
  daysOverdue: number; // 0 when not due yet, paid or void
  payments: Payment[];
  voidReason: string | null;
}

export interface Receivables {
  outstandingVnd: number;
  overdueVnd: number;
  collectedVnd: number;
  creditAppliedVnd: number;
  // Aging of what is still owed, by center.
  byCenter: {
    centerId: string;
    centerName: string;
    notDueVnd: number;
    d1to30Vnd: number;
    d31to60Vnd: number;
    over60Vnd: number;
  }[];
  overdue: Invoice[]; // most overdue first
}

export interface MyBilling {
  invoices: Invoice[]; // for the viewer's own household (guardian) or themselves (adult learner)
  outstandingVnd: number;
  walletVnd: number; // referral credit waiting for the next invoice
}

export type BillingRefusal =
  | "not_staff"
  | "not_org_admin"
  | "own_proposal" // maker-checker: an Org Admin cannot approve what they proposed
  | "not_found"
  | "invalid"
  | "invalid_step"
  | "no_fee_line" // no approved fee line for that course / center / period
  | "access_policy";

export type BillingResult<T = object> =
  ({ ok: true } & T) | { ok: false; reason: BillingRefusal; detail?: string };

export interface BillingPort {
  // Fee plans (staff of the organization read; staff propose; an Org Admin decides).
  listFeeLines(viewer: IiosGrantedContext, year: string): Promise<FeeLine[] | null>;
  years(viewer: IiosGrantedContext): Promise<string[] | null>;
  proposeFeeLine(viewer: IiosGrantedContext, draft: FeeLineDraft): Promise<BillingResult>;
  approveFeeLine(viewer: IiosGrantedContext, id: string): Promise<BillingResult>;
  rejectFeeLine(viewer: IiosGrantedContext, id: string, note: string): Promise<BillingResult>;
  retireFeeLine(viewer: IiosGrantedContext, id: string, note: string): Promise<BillingResult>;

  // Invoices. Generating is idempotent: one invoice per learner per fee line, ever.
  // Periods with approved tuition lines, oldest first; `current` = running today or the next one.
  periods(
    viewer: IiosGrantedContext,
  ): Promise<{ year: string; period: string; from: string; to: string; current: boolean }[] | null>;
  generateInvoices(
    viewer: IiosGrantedContext,
    year: string,
    period: string,
  ): Promise<BillingResult<{ created: number; existing: number; skippedNoLine: string[] }>>;
  issueFirstInvoice(
    viewer: IiosGrantedContext,
    leadId: string,
  ): Promise<BillingResult<{ invoiceNo: string }>>;
  listInvoices(viewer: IiosGrantedContext): Promise<Invoice[] | null>;
  recordPayment(
    viewer: IiosGrantedContext,
    invoiceId: string,
    amountVnd: number,
    method: PaymentMethod,
  ): Promise<BillingResult<{ receiptNo: string }>>;
  voidInvoice(
    viewer: IiosGrantedContext,
    invoiceId: string,
    reason: string,
  ): Promise<BillingResult>;
  listPayments(viewer: IiosGrantedContext): Promise<Payment[] | null>;
  getReceivables(viewer: IiosGrantedContext): Promise<Receivables | null>;

  // Guardian / adult learner: their own invoices, read-only. Everyone else: null.
  getMine(viewer: IiosGrantedContext): Promise<MyBilling | null>;
}
