import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Growth Engine · referrals — ADDITIVE, SYNTHETIC, mock only (pattern from EduOS SGE).
 *
 * Owner decisions (22/11):
 *  - referrers are GUARDIANS and ADULT learners; a learner under 18 has no link of their own
 *    (their guardian refers instead);
 *  - the reward is TUITION CREDIT in a wallet: a % of the referred family's first tuition payment,
 *    capped, applied to the referrer's next invoice — MOCK: nothing is charged or paid;
 *  - a referral counts only when the referred learner ENROLLS AND PAYS the first tuition, and
 *    center staff CONFIRM it, after anti-fraud checks (no self-referral, not the same household,
 *    one reward per new learner);
 *  - slice 1: link / code + share + link performance; the lead → placement → enrolled funnel for
 *    staff; wallet + referrer leaderboard; admin metrics (K-factor, cohorts, LTV uplift, campaigns).
 * Synthetic data only: the public lead form collects a display name and a course — no phone,
 * e-mail or other contact details.
 */

export const LeadStatus = z.enum(["lead", "placed", "enrolled", "confirmed", "rejected"]);
export type LeadStatus = z.infer<typeof LeadStatus>;

export const FraudFlag = z.enum([
  "self_referral", // the lead is the referrer's own learner record
  "same_household", // the lead is a learner already linked to the referrer's household
  "duplicate", // a lead / learner with the same name already exists at that center
  "already_rewarded", // this new learner already produced a reward
]);
export type FraudFlag = z.infer<typeof FraudFlag>;

export interface ReferralLead {
  id: string;
  code: string;
  referrerName: string; // staff view only
  learnerName: string;
  courseCode: string;
  centerName: string;
  campaignId: string | null;
  status: LeadStatus;
  createdAt: string;
  placedAt: string | null;
  enrolledAt: string | null;
  firstPaymentVnd: number | null;
  rewardVnd: number | null; // set when confirmed
  confirmedAt: string | null;
  rejectedReason: string | null;
  flags: FraudFlag[];
}

export interface WalletEntry {
  id: string;
  at: string;
  kind: "credit" | "applied";
  amountVnd: number; // credit > 0, applied < 0
  note: string; // e.g. "Referral: Bao T. enrolled in ENG-A2"
}

export interface ReferralProgram {
  enabled: boolean;
  rewardPct: number; // % of the first tuition payment
  capVnd: number; // maximum per referral
  campaigns: { id: string; name: string; active: boolean; bonusPct: number }[];
}

export interface MyReferrals {
  code: string;
  link: string;
  shareText: string;
  program: ReferralProgram;
  performance: { clicks: number; leads: number; conversions: number; convRatePct: number | null };
  myLeads: { learnerName: string; status: LeadStatus; createdAt: string }[];
  wallet: { balanceVnd: number; entries: WalletEntry[] };
  // Referrers see their own rank; other referrers are anonymous ("Ambassador #2").
  leaderboard: { rank: number; label: string; conversions: number; you: boolean }[];
}

export interface GrowthMetrics {
  referrers: number; // with a link
  activeReferrers: number; // at least one lead
  clicks: number;
  leads: number;
  confirmed: number;
  confirmedThisMonth: number;
  pendingRewards: number; // enrolled, waiting for staff confirmation
  kFactor: number; // confirmed new learners per referrer (k = invites × conversion)
  invitesPerReferrer: number;
  conversionPct: number | null; // confirmed / leads
  walletIssuedVnd: number;
  ltvUpliftPct: number | null; // referred vs other learners (mock model, see adapter)
  cohorts: { month: string; leads: number; confirmed: number; conversionPct: number | null }[];
  campaigns: { id: string; name: string; active: boolean; leads: number; confirmed: number }[];
  topReferrers: { name: string; leads: number; confirmed: number; rewardVnd: number }[];
}

export type GrowthRefusal =
  | "not_staff"
  | "not_found"
  | "invalid_step" // e.g. confirm before enrolled
  | "flagged" // confirm refused: fraud flags present
  | "invalid"
  | "access_policy";

export type GrowthResult = { ok: true } | { ok: false; reason: GrowthRefusal; detail?: string };

export interface GrowthPort {
  // Guardian or adult learner: their own link, wallet, rank. Everyone else: null.
  getMine(viewer: IiosGrantedContext): Promise<MyReferrals | null>;
  // Public landing (no sign-in): a click on a shared link, and the synthetic lead form.
  recordClick(
    code: string,
  ): Promise<{ valid: boolean; centerNames: string[]; courses: { code: string; title: string }[] }>;
  submitLead(
    code: string,
    input: {
      learnerName: string;
      courseCode: string;
      centerName: string;
      campaignId?: string | null;
    },
  ): Promise<GrowthResult>;
  // Center staff of the organization.
  listLeads(viewer: IiosGrantedContext): Promise<ReferralLead[] | null>;
  markPlaced(viewer: IiosGrantedContext, leadId: string): Promise<GrowthResult>;
  markEnrolled(
    viewer: IiosGrantedContext,
    leadId: string,
    firstPaymentVnd: number,
  ): Promise<GrowthResult>;
  confirm(viewer: IiosGrantedContext, leadId: string): Promise<GrowthResult>;
  reject(viewer: IiosGrantedContext, leadId: string, reason: string): Promise<GrowthResult>;
  getMetrics(viewer: IiosGrantedContext): Promise<GrowthMetrics | null>;
  getProgram(viewer: IiosGrantedContext): Promise<ReferralProgram | null>;
  updateProgram(viewer: IiosGrantedContext, patch: Partial<ReferralProgram>): Promise<GrowthResult>;
}
