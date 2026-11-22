import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Admissions Intelligence — ADDITIVE, SYNTHETIC, mock only (pattern from EduOS Admissions).
 *
 * Owner decisions (22/11):
 *  - slice 1 = admissions pipeline + an explainable lead score + a funnel / counselor dashboard
 *    (Current Students is a separate slice);
 *  - ONE pipeline: every lead (referral, walk-in, website, event, phone) lives here; a referral lead
 *    carries its referrer. The Growth Engine reads its referral leads from this pipeline and only
 *    decides the reward; placement and the first invoice happen in one place;
 *  - MINIMAL lead profile: a synthetic display name, course, center, source, preferred channel,
 *    learning needs from a closed list and a short note. No real phone / e-mail, no financial
 *    situation, no visa / immigration status;
 *  - every rate on the dashboard shows its numerator and denominator and can never exceed 100%.
 */

export type LeadStage =
  | "new"
  | "assigned"
  | "contacted"
  | "placement" // placement test done
  | "offer" // first invoice issued (Billing)
  | "enrolled" // first invoice paid in full (Billing)
  | "lost";
export const OPEN_STAGES: readonly LeadStage[] = [
  "new",
  "assigned",
  "contacted",
  "placement",
  "offer",
];
export const FUNNEL: readonly LeadStage[] = [
  "new",
  "assigned",
  "contacted",
  "placement",
  "offer",
  "enrolled",
];
/** Stages staff set by hand. "offer" and "enrolled" are set by Billing only. */
export const MANUAL_STAGES: readonly LeadStage[] = [
  "new",
  "assigned",
  "contacted",
  "placement",
  "lost",
];

export type LeadSource = "referral" | "walk_in" | "website" | "event" | "phone";
export type ContactChannel = "zalo" | "phone" | "email" | "in_person";
export type LearningNeed =
  | "exam_prep"
  | "speaking_confidence"
  | "school_support"
  | "work_english"
  | "travel"
  | "young_learner";
export const LEARNING_NEEDS: readonly LearningNeed[] = [
  "exam_prep",
  "speaking_confidence",
  "school_support",
  "work_english",
  "travel",
  "young_learner",
];
export type LeadActivityKind = "call" | "message" | "meeting" | "note";

export type ScoreKey = "source" | "course_fit" | "engagement" | "recency" | "progress";
export const SCORE_KEYS: readonly ScoreKey[] = [
  "source",
  "course_fit",
  "engagement",
  "recency",
  "progress",
];
export type ScoreBand = "hot" | "warm" | "cold";

export interface ScorePart {
  key: ScoreKey;
  points: number;
  max: number;
  why: string; // plain words: what earned the points
}

export interface LeadActivity {
  id: string;
  at: string;
  by: string;
  kind: LeadActivityKind;
  text: string;
}

export interface Lead {
  id: string;
  learnerName: string;
  courseCode: string;
  centerId: string;
  centerName: string;
  source: LeadSource;
  referredBy: string | null; // referrer's display name (referral leads)
  campaignId: string | null;
  channel: ContactChannel | null;
  needs: LearningNeed[];
  note: string;
  stage: LeadStage;
  stageHistory: { stage: LeadStage; at: string; by: string }[];
  assignedTo: { principalId: string; name: string } | null;
  activities: LeadActivity[]; // newest first
  invoiceNo: string | null;
  firstPaymentVnd: number | null;
  lostReason: string | null;
  createdAt: string;
  lastTouchAt: string;
  firstResponseHours: number | null;
  stale: boolean;
  score: { total: number; band: ScoreBand; parts: ScorePart[] };
}

export interface LeadDraft {
  learnerName: string;
  courseCode: string;
  centerId: string;
  source: Exclude<LeadSource, "referral">; // referral leads arrive through a referral link
  channel: ContactChannel | null;
  needs: LearningNeed[];
  note: string;
}

export interface ScoringSettings {
  max: Record<ScoreKey, number>; // points per part, summing to 100
  hotAt: number;
  warmAt: number;
  staleDays: number;
}

export interface Ratio {
  reached: number;
  of: number;
  pct: number | null; // null when `of` is 0
}

export interface AdmissionsDashboard {
  total: number;
  open: number;
  enrolled: number;
  lost: number;
  byStage: { stage: LeadStage; count: number }[]; // current stage
  conversions: ({ from: LeadStage; to: LeadStage } & Ratio)[]; // consecutive funnel steps
  leadToEnrolled: Ratio;
  firstResponse: { avgHours: number | null; measured: number; of: number };
  stale: number;
  staleDays: number;
  bands: Record<ScoreBand, number>; // open leads
  bySource: ({ source: LeadSource; leads: number } & Ratio)[]; // reached = enrolled
  counselors: {
    principalId: string;
    name: string;
    assigned: number;
    contacted: number;
    enrolled: number;
    conversion: Ratio; // enrolled of assigned
    avgFirstResponseHours: number | null;
    stale: number;
  }[];
}

export type AdmissionsRefusal =
  "not_staff" | "not_found" | "invalid" | "invalid_step" | "access_policy";
export type AdmissionsResult =
  { ok: true; id?: string } | { ok: false; reason: AdmissionsRefusal; detail?: string };

export interface AdmissionsPort {
  // Center staff of the organization, within the centers their policy allows for admissions.
  listLeads(viewer: IiosGrantedContext): Promise<Lead[] | null>;
  counselors(viewer: IiosGrantedContext): Promise<{ principalId: string; name: string }[] | null>;
  createLead(viewer: IiosGrantedContext, draft: LeadDraft): Promise<AdmissionsResult>;
  assign(
    viewer: IiosGrantedContext,
    leadId: string,
    principalId: string,
  ): Promise<AdmissionsResult>;
  moveStage(
    viewer: IiosGrantedContext,
    leadId: string,
    stage: LeadStage,
    reason?: string, // required for "lost"
  ): Promise<AdmissionsResult>;
  logActivity(
    viewer: IiosGrantedContext,
    leadId: string,
    kind: LeadActivityKind,
    text: string,
  ): Promise<AdmissionsResult>;
  getDashboard(viewer: IiosGrantedContext): Promise<AdmissionsDashboard | null>;
  getSettings(viewer: IiosGrantedContext): Promise<ScoringSettings | null>;
  updateSettings(viewer: IiosGrantedContext, next: ScoringSettings): Promise<AdmissionsResult>;
}
