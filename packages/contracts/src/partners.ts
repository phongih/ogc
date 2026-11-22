import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Partner Commissions — ADDITIVE, SYNTHETIC, mock only. The organization hands a lead it cannot
 * serve to a partner center and earns a tiered commission when the learner enrols there.
 * Owner decisions (22/11):
 *  - a lead goes out from the Admissions pipeline ("Refer to partner"): it closes at OGC as
 *    "referred to partner" and opens one ledger entry. Only a reference code, a short display
 *    name and the course go to the partner — nothing else;
 *  - partner suggestions are ranked by FIT FOR THE LEARNER (course taught, near the learner's
 *    center, how many learners stay). The commission is shown for information only and is never
 *    used to rank (no routing by money);
 *  - staff (partners:manage) refer leads and record what partners report (enrolled, paid);
 *    an Org Admin activates a new tier rule version and approves an entry for settlement — never
 *    their own step (maker-checker, like Billing);
 *  - Decision signals only suggest (near next tier, stale referral, high rejection rate, overdue
 *    settlement); a person follows, snoozes or dismisses with a reason; every step goes into an
 *    append-only activity log. Nothing changes status or money by itself.
 * Slice 2 (owner 22/11):
 *  - settlement batches per partner and cycle: staff draft one from approved entries, an Org Admin
 *    (not the one who drafted it) sends it — then it is locked; the partner pays the WHOLE batch,
 *    staff record it and every entry becomes paid. A wrong batch is cancelled with a reason and
 *    drafted again. Payments are recorded per batch only;
 *  - partner reports (pasted CSV) are previewed against the ledger — matches, already recorded,
 *    conflicts, unknown codes — and a person applies each applicable row; nothing applies itself;
 *  - trends per partner over six months by referral month, every rate with its counts.
 * Money here is a mock receivable — nothing is invoiced, collected or paid.
 */

export type CommissionCycle = "monthly" | "quarterly";
export type CommissionMode = "progressive" | "retroactive";

export interface CommissionTier {
  minCount: number; // the n-th enrolment in the cycle from which this amount applies (1-based)
  amountVnd: number;
}

export type RuleStatus = "pending" | "active" | "retired" | "rejected";

export interface TierRule {
  id: string;
  partnerId: string;
  version: number;
  status: RuleStatus;
  cycle: CommissionCycle;
  mode: CommissionMode; // progressive: each enrolment at its own tier; retroactive: all at the tier reached
  tiers: CommissionTier[]; // ascending minCount, first is 1
  attributionWindowDays: number; // the partner must report the enrolment within this many days
  clawbackWindowDays: number; // wait after enrolment before an entry can be approved
  dataClassification: "internal" | "confidential";
  proposedBy: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  mine: boolean; // proposed by the viewer
}

export type TierRuleDraft = Pick<
  TierRule,
  "cycle" | "mode" | "tiers" | "attributionWindowDays" | "clawbackWindowDays"
>;

export interface Partner {
  id: string;
  name: string; // synthetic
  courses: string[]; // course codes the partner teaches
  nearCenters: string[]; // names of the organization's centers it is close to
  retentionPct: number; // share of referred learners still learning after 3 months (synthetic)
  settlementDays: number; // days the partner has to pay an approved entry
  rule: TierRule | null; // the active rule
  pendingRule: TierRule | null;
  history: TierRule[]; // every version, newest first
}

export type CommissionStatus = "referred" | "enrolled" | "approved" | "paid" | "rejected";

export interface CommissionEntry {
  id: string;
  partnerId: string;
  partnerName: string;
  leadRefCode: string; // what the partner sees; never a phone number or e-mail
  learnerDisplayName: string;
  courseCode: string;
  referredAt: string;
  expiresAt: string; // referredAt + attribution window
  enrolledAt: string | null;
  status: CommissionStatus;
  cycleLabel: string | null; // e.g. "Nov 2026" / "Q4 2026", from the enrolment date
  appliedRuleVersion: number | null;
  appliedTierIndex: number | null; // 1-based
  amountVnd: number | null; // provisional for a retroactive rule until its cycle ends
  provisional: boolean;
  approvableFrom: string | null; // when it may be approved (clawback / cycle end)
  dueDate: string | null; // approved: the partner should pay by then
  rejectReason: string | null;
  settledBatchId: string | null; // the paid batch
  batchId: string | null; // the open (draft / sent) or paid batch holding the entry
  updatedBy: string;
  updatedAt: string;
  enrolledBy: string | null; // principal who recorded the enrolment (maker-checker)
}

export type SignalRule =
  "near_next_tier" | "stale_referral" | "high_rejection_rate" | "overdue_settlement";
export type SignalState = "open" | "snoozed" | "dismissed" | "followed";

export interface DecisionSignal {
  id: string; // stable for the same situation (rule + partner + subject)
  rule: SignalRule;
  partnerId: string;
  partnerName: string;
  message: string; // plain words, with the numbers behind it
  evidence: string[];
  state: SignalState;
  note: string | null;
}

export interface PartnerSummary {
  partnerId: string;
  partnerName: string;
  referred: number;
  enrolled: number;
  approved: number;
  paid: number;
  rejected: number;
  receivedVnd: number;
  awaitingPaymentVnd: number;
  overdueVnd: number;
  cycleCount: number; // enrolments in the current cycle
  currentTierAmountVnd: number | null;
  nextTier: { at: number; amountVnd: number } | null;
}

export interface PartnersOverview {
  kpis: {
    receivedVnd: number;
    awaitingPaymentVnd: number;
    awaitingEnrolment: number; // entries still "referred"
    nextTierUpliftVnd: number; // extra if every partner reached its next tier with one more enrolment
  };
  partners: PartnerSummary[];
  signals: DecisionSignal[]; // open first
  canManage: boolean;
  isOrgAdmin: boolean;
}

export interface PartnerFit {
  partnerId: string;
  partnerName: string;
  fits: boolean; // teaches the course
  reasons: string[]; // why it fits / does not
  score: number; // fit only: course, near the learner's center, retention
  commissionInfo: string | null; // information only — never used to rank
}

export interface ActivityEntry {
  at: string;
  by: string;
  action: string;
  subject: string;
  detail: string | null;
}

export type PartnersRefusal =
  | "not_staff"
  | "not_org_admin"
  | "not_found"
  | "invalid"
  | "invalid_step"
  | "own_step"
  | "access_policy";
export type PartnersResult = { ok: true } | { ok: false; reason: PartnersRefusal; detail?: string };

/**
 * Commission for the n-th enrolment of a cycle (1-based) — plain arithmetic, the same on the page
 * and in tests. Progressive: the n-th enrolment earns the tier it falls in. Retroactive: every
 * enrolment of the cycle earns the tier the cycle's count reached.
 */
export function tierIndexFor(tiers: CommissionTier[], n: number): number {
  let idx = 0;
  tiers.forEach((t, i) => {
    if (n >= t.minCount) idx = i;
  });
  return idx;
}
export function commissionFor(
  rule: Pick<TierRule, "mode" | "tiers">,
  position: number,
  cycleCount: number,
): { tierIndex: number; amountVnd: number } {
  const i = tierIndexFor(rule.tiers, rule.mode === "progressive" ? position : cycleCount);
  return { tierIndex: i + 1, amountVnd: rule.tiers[i].amountVnd };
}

/** Plain-words problem with a draft rule, or null. Shared by the page and the adapter. */
export function tierRuleIssue(d: TierRuleDraft): string | null {
  if (d.cycle !== "monthly" && d.cycle !== "quarterly") return "cycle must be monthly or quarterly";
  if (d.mode !== "progressive" && d.mode !== "retroactive")
    return "mode must be progressive or retroactive";
  if (!Array.isArray(d.tiers) || d.tiers.length < 1 || d.tiers.length > 6) return "1–6 tiers";
  if (d.tiers[0].minCount !== 1) return "the first tier starts at 1";
  for (let i = 0; i < d.tiers.length; i++) {
    const t = d.tiers[i];
    if (!Number.isInteger(t.minCount) || t.minCount < 1) return "tier starts must be whole numbers";
    if (i > 0 && t.minCount <= d.tiers[i - 1].minCount) return "tier starts must go up";
    if (!Number.isInteger(t.amountVnd) || t.amountVnd < 0 || t.amountVnd > 100_000_000)
      return "amounts must be 0–100,000,000 ₫";
  }
  if (
    !Number.isInteger(d.attributionWindowDays) ||
    d.attributionWindowDays < 7 ||
    d.attributionWindowDays > 180
  )
    return "attribution window: 7–180 days";
  if (
    !Number.isInteger(d.clawbackWindowDays) ||
    d.clawbackWindowDays < 0 ||
    d.clawbackWindowDays > 60
  )
    return "clawback window: 0–60 days";
  return null;
}

// ── slice 2 ───────────────────────────────────────────────────────────────────────────────

export type BatchStatus = "draft" | "sent" | "paid" | "cancelled";

export interface SettlementBatch {
  id: string; // e.g. ST-LOTUS-02
  partnerId: string;
  partnerName: string;
  cycleLabel: string; // enrolment cycle the batch settles, e.g. "Oct 2026" / "Q4 2026"
  entries: { id: string; leadRefCode: string; learnerDisplayName: string; amountVnd: number }[];
  totalVnd: number;
  status: BatchStatus;
  createdBy: string;
  createdAt: string;
  sentBy: string | null;
  sentAt: string | null;
  dueDate: string | null; // sent + the partner's settlement days
  paidBy: string | null;
  paidAt: string | null;
  paymentRef: string | null;
  cancelReason: string | null;
  mine: boolean; // drafted by the viewer (cannot send it)
  overdue: boolean;
}

export interface BatchCandidate {
  partnerId: string;
  partnerName: string;
  cycleLabel: string;
  entries: number;
  totalVnd: number;
}

export type ReportStatus = "enrolled" | "rejected";
export type ReportMatch = "applicable" | "already" | "conflict" | "not_found" | "invalid";

export interface ReportRow {
  line: number;
  leadRefCode: string | null;
  reported: ReportStatus | null;
  date: string | null; // YYYY-MM-DD, the partner's enrolment date
  reason: string | null;
  match: ReportMatch;
  explanation: string;
  learnerDisplayName: string | null;
}

export interface TrendMonth {
  month: string; // YYYY-MM, by referral month
  referred: number;
  enrolled: number; // of those referred that month
  rejected: number;
  open: number;
  conversion: { n: number; d: number; pct: number | null }; // enrolled / (enrolled + rejected)
  medianDaysToEnrol: number | null;
}

export interface PartnerTrend {
  partnerId: string;
  partnerName: string;
  months: TrendMonth[]; // six months, oldest first
}

export interface PartnersPort {
  // Center staff with partners:manage (and the Org Admin). Others: null.
  getOverview(viewer: IiosGrantedContext): Promise<PartnersOverview | null>;
  listPartners(viewer: IiosGrantedContext): Promise<Partner[] | null>;
  listEntries(viewer: IiosGrantedContext): Promise<CommissionEntry[] | null>;
  listActivity(viewer: IiosGrantedContext): Promise<ActivityEntry[] | null>;
  // Admissions: partners for one lead, ranked by fit for the learner.
  suggestPartners(viewer: IiosGrantedContext, leadId: string): Promise<PartnerFit[] | null>;
  referLead(viewer: IiosGrantedContext, leadId: string, partnerId: string): Promise<PartnersResult>;
  // What the partner reports (staff) …
  markEnrolled(viewer: IiosGrantedContext, entryId: string): Promise<PartnersResult>;
  reject(viewer: IiosGrantedContext, entryId: string, reason: string): Promise<PartnersResult>;
  // … and what an Org Admin approves (never their own step).
  approve(viewer: IiosGrantedContext, entryId: string): Promise<PartnersResult>;
  proposeRule(
    viewer: IiosGrantedContext,
    partnerId: string,
    draft: TierRuleDraft,
  ): Promise<PartnersResult>;
  decideRule(
    viewer: IiosGrantedContext,
    ruleId: string,
    decision: "activate" | "reject",
  ): Promise<PartnersResult>;
  // Settlement batches (slice 2): staff draft, an Org Admin sends, the partner pays the whole batch.
  listBatches(viewer: IiosGrantedContext): Promise<SettlementBatch[] | null>;
  batchCandidates(viewer: IiosGrantedContext): Promise<BatchCandidate[] | null>;
  draftBatch(
    viewer: IiosGrantedContext,
    partnerId: string,
    cycleLabel: string,
  ): Promise<PartnersResult>;
  sendBatch(viewer: IiosGrantedContext, batchId: string): Promise<PartnersResult>;
  markBatchPaid(
    viewer: IiosGrantedContext,
    batchId: string,
    paymentRef: string,
  ): Promise<PartnersResult>;
  cancelBatch(viewer: IiosGrantedContext, batchId: string, reason: string): Promise<PartnersResult>;
  // Partner reports (slice 2): preview, then a person applies one row at a time.
  previewReport(
    viewer: IiosGrantedContext,
    partnerId: string,
    csv: string,
  ): Promise<ReportRow[] | null>;
  applyReportRow(
    viewer: IiosGrantedContext,
    partnerId: string,
    row: Pick<ReportRow, "leadRefCode" | "reported" | "date" | "reason">,
  ): Promise<PartnersResult>;
  // Trends (slice 2).
  getTrends(viewer: IiosGrantedContext): Promise<PartnerTrend[] | null>;
  // Signals: a person decides.
  actOnSignal(
    viewer: IiosGrantedContext,
    signalId: string,
    action: "follow" | "snooze" | "dismiss",
    note?: string,
  ): Promise<PartnersResult>;
}
