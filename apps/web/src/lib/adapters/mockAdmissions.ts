/*
 * Admissions Intelligence — MOCK adapter (SYNTHETIC, browser memory; pattern from EduOS
 * Admissions). Owner decisions 22/11 (see packages/contracts/src/admissions.ts):
 *  - ONE pipeline for every lead; the Growth Engine reads its referral leads from here and Billing
 *    moves a lead to "offer" (first invoice) and "enrolled" (paid in full);
 *  - an explainable, staff-tunable lead score (parts + reasons, no hidden model);
 *  - a minimal profile — synthetic name, course, center, source, channel, needs, a short note;
 *  - dashboard rates carry numerator and denominator and never exceed 100%.
 * Staff act within the centers their access policy allows (`admissions:manage`, IIOS-decided).
 */
import type {
  LeadActivityKind,
  AdmissionsDashboard,
  AdmissionsPort,
  AdmissionsResult,
  ContactChannel,
  IiosGrantedContext,
  Lead,
  LeadActivity,
  LeadSource,
  LeadStage,
  LearningNeed,
  Ratio,
  ScoreBand,
  ScoreKey,
  ScorePart,
  ScoringSettings,
} from "@ogc/contracts";
import { FUNNEL, LEARNING_NEEDS, MANUAL_STAGES, OPEN_STAGES, SCORE_KEYS } from "@ogc/contracts";
import { centers, organizations } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { classes } from "../../fixtures/teaching";
import { members } from "../../fixtures/personas";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { allows, centerScope, inScope } from "./accessPolicy";
import { displayNameOf, staffOrgOf } from "./viewer";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
type Refusal = Exclude<AdmissionsResult, { ok: true }>;
const refuse = (reason: Refusal["reason"], detail?: string) =>
  latency<AdmissionsResult>({ ok: false, reason, ...(detail ? { detail } : {}) });
const ok = (id?: string) => latency<AdmissionsResult>(id ? { ok: true, id } : { ok: true });

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// ── state ───────────────────────────────────────────────────────────────────────────────────

export interface StoredLead {
  id: string;
  orgId: string;
  learnerName: string;
  courseCode: string;
  centerId: string;
  source: LeadSource;
  referral: { code: string; principalId: string; name: string; campaignId: string | null } | null;
  channel: ContactChannel | null;
  needs: LearningNeed[];
  note: string;
  stage: LeadStage;
  history: { stage: LeadStage; at: string; by: string }[];
  assignedTo: string | null; // principal id of a staff member
  activities: LeadActivity[]; // oldest first
  invoiceNo: string | null;
  firstPaymentVnd: number | null;
  lostReason: string | null;
  createdAt: string;
}

export const DEFAULT_SETTINGS: ScoringSettings = {
  max: { source: 25, course_fit: 20, engagement: 20, recency: 20, progress: 15 },
  hotAt: 70,
  warmAt: 40,
  staleDays: 7,
};

const leads = new Map<string, StoredLead>();
const settings = new Map<string, ScoringSettings>(); // orgId → settings
let seq = 0;

const NOVA = organizations[0].id;
const SAM = members.find((m) => m.personaId === "demo-staff")!;
const OLIVIA = members.find((m) => m.personaId === "demo-admin")!;

/** Synthetic leads, dated relative to "now" so the dashboard always has fresh and stale ones. */
function seed(now = Date.now()) {
  const ago = (d: number, h = 0) => new Date(now - d * DAY - h * HOUR).toISOString();
  type S = {
    name: string;
    course: string;
    center: number;
    source: Exclude<LeadSource, "referral">;
    channel: ContactChannel | null;
    needs: LearningNeed[];
    created: number; // days ago
    path: { stage: LeadStage; d: number }[]; // stage changes, days ago
    who?: typeof SAM;
    acts?: { d: number; kind: LeadActivityKind; text: string }[];
    lost?: string;
  };
  const seeds: S[] = [
    {
      name: "Hoa P.",
      course: "ENG-A2",
      center: 0,
      source: "walk_in",
      channel: "zalo",
      needs: ["speaking_confidence"],
      created: 1,
      path: [],
    },
    {
      name: "Quan T.",
      course: "IELTS-B2",
      center: 0,
      source: "website",
      channel: "email",
      needs: ["exam_prep"],
      created: 0,
      path: [],
    },
    {
      name: "Lan H.",
      course: "ENG-B1",
      center: 1,
      source: "event",
      channel: "phone",
      needs: ["work_english"],
      created: 3,
      path: [{ stage: "assigned", d: 3 }],
      who: SAM,
    },
    {
      name: "Tuan K.",
      course: "ENG-A2",
      center: 0,
      source: "phone",
      channel: "phone",
      needs: ["school_support"],
      created: 20,
      path: [{ stage: "assigned", d: 19 }],
      who: SAM,
    },
    {
      name: "Ngoc D.",
      course: "ENG-A2",
      center: 0,
      source: "walk_in",
      channel: "in_person",
      needs: ["young_learner", "speaking_confidence"],
      created: 6,
      path: [
        { stage: "assigned", d: 6 },
        { stage: "contacted", d: 5 },
      ],
      who: SAM,
      acts: [
        { d: 5, kind: "call", text: "Talked about the A2 timetable" },
        { d: 2, kind: "message", text: "Sent the trial-lesson times" },
      ],
    },
    {
      name: "Bich L.",
      course: "ENG-B1",
      center: 1,
      source: "website",
      channel: "zalo",
      needs: ["work_english"],
      created: 12,
      path: [
        { stage: "assigned", d: 12 },
        { stage: "contacted", d: 11 },
      ],
      who: OLIVIA,
      acts: [{ d: 11, kind: "call", text: "Wants evening classes" }],
    },
    {
      name: "Son V.",
      course: "IELTS-B2",
      center: 0,
      source: "event",
      channel: "email",
      needs: ["exam_prep"],
      created: 9,
      path: [
        { stage: "assigned", d: 9 },
        { stage: "contacted", d: 8 },
        { stage: "placement", d: 4 },
      ],
      who: OLIVIA,
      acts: [
        { d: 8, kind: "call", text: "Booked a placement test" },
        { d: 4, kind: "meeting", text: "Placement test: B1+, aiming for IELTS 6.5" },
      ],
    },
    {
      name: "Yen T.",
      course: "ENG-A2",
      center: 0,
      source: "walk_in",
      channel: "in_person",
      needs: ["travel"],
      created: 15,
      path: [
        { stage: "assigned", d: 15 },
        { stage: "contacted", d: 14 },
        { stage: "placement", d: 13 },
      ],
      who: SAM,
      acts: [
        { d: 14, kind: "call", text: "Placement booked" },
        { d: 13, kind: "meeting", text: "Placement test done: A2" },
      ],
    },
    {
      name: "Khanh M.",
      course: "ENG-B1",
      center: 1,
      source: "phone",
      channel: "phone",
      needs: ["school_support"],
      created: 2,
      path: [
        { stage: "assigned", d: 2 },
        { stage: "contacted", d: 1 },
      ],
      who: OLIVIA,
      acts: [{ d: 1, kind: "call", text: "Parent asked about class size" }],
    },
    {
      name: "Duc A.",
      course: "ENG-A2",
      center: 2,
      source: "website",
      channel: "zalo",
      needs: ["young_learner"],
      created: 25,
      path: [
        { stage: "assigned", d: 24 },
        { stage: "contacted", d: 23 },
      ],
      who: SAM,
      acts: [{ d: 23, kind: "message", text: "No reply yet" }],
    },
    {
      name: "Trang B.",
      course: "ENG-A2",
      center: 0,
      source: "event",
      channel: "zalo",
      needs: ["speaking_confidence"],
      created: 40,
      path: [
        { stage: "assigned", d: 40 },
        { stage: "contacted", d: 39 },
        { stage: "placement", d: 35 },
        { stage: "enrolled", d: 30 },
      ],
      who: SAM,
      acts: [
        { d: 39, kind: "call", text: "Interested in mornings" },
        { d: 35, kind: "meeting", text: "Placement test: A2" },
      ],
    },
    {
      name: "Long H.",
      course: "ENG-B1",
      center: 1,
      source: "walk_in",
      channel: "in_person",
      needs: ["work_english"],
      created: 50,
      path: [
        { stage: "assigned", d: 50 },
        { stage: "contacted", d: 49 },
        { stage: "placement", d: 47 },
        { stage: "enrolled", d: 44 },
      ],
      who: OLIVIA,
      acts: [{ d: 49, kind: "call", text: "Booked placement" }],
    },
    {
      name: "Nhi C.",
      course: "IELTS-B2",
      center: 0,
      source: "website",
      channel: "email",
      needs: ["exam_prep"],
      created: 30,
      path: [
        { stage: "assigned", d: 30 },
        { stage: "contacted", d: 28 },
        { stage: "lost", d: 20 },
      ],
      who: OLIVIA,
      acts: [{ d: 28, kind: "call", text: "Comparing with another center" }],
      lost: "Chose another center",
    },
    {
      name: "Vinh S.",
      course: "ENG-A2",
      center: 2,
      source: "phone",
      channel: "phone",
      needs: ["young_learner"],
      created: 18,
      path: [
        { stage: "assigned", d: 18 },
        { stage: "lost", d: 10 },
      ],
      who: SAM,
      lost: "Timetable does not fit",
    },
  ];
  for (const s of seeds) {
    const center = centers.filter((c) => c.orgId === NOVA)[s.center];
    const history = [{ stage: "new" as LeadStage, at: ago(s.created), by: "Website form" }];
    for (const p of s.path)
      history.push({ stage: p.stage, at: ago(p.d, 1), by: (s.who ?? SAM).displayName });
    const id = `ADM-${++seq}`;
    leads.set(id, {
      id,
      orgId: NOVA,
      learnerName: s.name,
      courseCode: s.course,
      centerId: center.id,
      source: s.source,
      referral: null,
      channel: s.channel,
      needs: s.needs,
      note: "",
      stage: history[history.length - 1].stage,
      history,
      assignedTo: s.who?.principalId ?? null,
      activities: (s.acts ?? []).map((a, i) => ({
        id: `${id}-A${i + 1}`,
        at: ago(a.d),
        by: (s.who ?? SAM).displayName,
        kind: a.kind,
        text: a.text,
      })),
      invoiceNo: null,
      firstPaymentVnd: null,
      lostReason: s.lost ?? null,
      createdAt: ago(s.created),
    });
  }
}

function reset() {
  leads.clear();
  settings.clear();
  seq = 0;
  seed();
}
sessionStore.onReset(reset);
export const __resetAdmissionsForTests = reset;
registerPersistent("admissions", {
  dump: () => ({ leads, settings, seq }),
  load: (raw) => {
    const r = raw as { leads?: unknown; settings?: unknown; seq?: number };
    refill(leads, r.leads);
    refill(settings, r.settings);
    seq = Number(r.seq) || 0;
  },
});

// ── score + derived fields ──────────────────────────────────────────────────────────────────

const settingsOf = (orgId: string): ScoringSettings =>
  settings.get(orgId) ?? structuredClone(DEFAULT_SETTINGS);

const SOURCE_SHARE: Record<LeadSource, number> = {
  referral: 1,
  walk_in: 0.8,
  event: 0.6,
  website: 0.4,
  phone: 0.4,
};
const SOURCE_LABEL: Record<LeadSource, string> = {
  referral: "a referral",
  walk_in: "a walk-in",
  event: "an event",
  website: "the website",
  phone: "a phone enquiry",
};
const PROGRESS_SHARE: Record<LeadStage, number> = {
  new: 0,
  assigned: 0.2,
  contacted: 0.4,
  placement: 0.7,
  offer: 1,
  enrolled: 1,
  lost: 0,
};
const STAGE_WORDS: Record<LeadStage, string> = {
  new: "new",
  assigned: "assigned",
  contacted: "contacted",
  placement: "placement test done",
  offer: "first invoice issued",
  enrolled: "enrolled",
  lost: "lost",
};
const stageIndex = (s: LeadStage) => FUNNEL.indexOf(s);
/** The furthest funnel stage the lead ever reached (a lost lead keeps what it reached before). */
const reachedIndex = (l: StoredLead) =>
  Math.max(0, ...l.history.map((h) => stageIndex(h.stage)).filter((i) => i >= 0));

const lastTouchOf = (l: StoredLead) =>
  [l.createdAt, ...l.history.map((h) => h.at), ...l.activities.map((a) => a.at)].sort().pop()!;

/** Hours from the lead's arrival to the first human touch (an activity or "contacted"). */
function firstResponseHours(l: StoredLead): number | null {
  const touches = [
    ...l.activities.map((a) => a.at),
    ...l.history.filter((h) => stageIndex(h.stage) >= stageIndex("contacted")).map((h) => h.at),
  ].sort();
  if (!touches.length) return null;
  return Math.max(
    0,
    Math.round(((Date.parse(touches[0]) - Date.parse(l.createdAt)) / HOUR) * 10) / 10,
  );
}

export function scoreOf(l: StoredLead, s: ScoringSettings, now = Date.now()) {
  const parts: ScorePart[] = [];
  const part = (key: ScoreKey, share: number, why: string) =>
    parts.push({ key, points: Math.round(s.max[key] * share), max: s.max[key], why });
  part("source", SOURCE_SHARE[l.source], `Came from ${SOURCE_LABEL[l.source]}`);
  const here = classes.some(
    (c) =>
      c.centerId === l.centerId && courses.find((x) => x.id === c.courseId)?.code === l.courseCode,
  );
  const elsewhere = classes.some(
    (c) => c.orgId === l.orgId && courses.find((x) => x.id === c.courseId)?.code === l.courseCode,
  );
  part(
    "course_fit",
    here ? 1 : elsewhere ? 0.5 : 0,
    here
      ? `${l.courseCode} has a class at this center`
      : elsewhere
        ? `${l.courseCode} runs at another center only`
        : `No ${l.courseCode} class yet`,
  );
  const n = l.activities.length;
  part("engagement", Math.min(n, 4) / 4, `${n} logged ${n === 1 ? "activity" : "activities"}`);
  const days = Math.floor((now - Date.parse(lastTouchOf(l))) / DAY);
  part(
    "recency",
    days <= 2 ? 1 : days <= 7 ? 0.5 : days <= 14 ? 0.25 : 0,
    days === 0 ? "Touched today" : `Last touched ${days} day${days === 1 ? "" : "s"} ago`,
  );
  part("progress", PROGRESS_SHARE[l.stage], `Stage: ${STAGE_WORDS[l.stage]}`);
  const total = parts.reduce((t, p) => t + p.points, 0);
  const band: ScoreBand = total >= s.hotAt ? "hot" : total >= s.warmAt ? "warm" : "cold";
  return { total, band, parts };
}

const isOpen = (l: StoredLead) => OPEN_STAGES.includes(l.stage);
const isStale = (l: StoredLead, s: ScoringSettings, now: number) =>
  isOpen(l) && now - Date.parse(lastTouchOf(l)) > s.staleDays * DAY;

const nameOfPrincipal = (p: string) => members.find((m) => m.principalId === p)?.displayName ?? p;
const centerNameOf = (id: string) => centers.find((c) => c.id === id)?.name ?? "Unknown center";

function view(l: StoredLead, now = Date.now()): Lead {
  const s = settingsOf(l.orgId);
  return {
    id: l.id,
    learnerName: l.learnerName,
    courseCode: l.courseCode,
    centerId: l.centerId,
    centerName: centerNameOf(l.centerId),
    source: l.source,
    referredBy: l.referral?.name ?? null,
    campaignId: l.referral?.campaignId ?? null,
    channel: l.channel,
    needs: [...l.needs],
    note: l.note,
    stage: l.stage,
    stageHistory: l.history.map((h) => ({ ...h })),
    assignedTo: l.assignedTo
      ? { principalId: l.assignedTo, name: nameOfPrincipal(l.assignedTo) }
      : null,
    activities: [...l.activities].reverse().map((a) => ({ ...a })),
    invoiceNo: l.invoiceNo,
    firstPaymentVnd: l.firstPaymentVnd,
    lostReason: l.lostReason,
    createdAt: l.createdAt,
    lastTouchAt: lastTouchOf(l),
    firstResponseHours: firstResponseHours(l),
    stale: isStale(l, s, now),
    score: scoreOf(l, s, now),
  };
}

const ratio = (reached: number, of: number): Ratio => ({
  reached,
  of,
  pct: of > 0 ? Math.round((reached / of) * 1000) / 10 : null,
});
const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 10) / 10 : null;

// ── access ──────────────────────────────────────────────────────────────────────────────────

/** Staff members of an organization (who leads can be assigned to). */
const counselorsOf = (orgId: string) =>
  members.filter((m) => m.orgId === orgId && (m.role === "staff" || m.role === "admin"));

function scoped(viewer: IiosGrantedContext): StoredLead[] | null {
  const org = staffOrgOf(viewer);
  if (!org) return null;
  const scope = centerScope(viewer, "admissions:manage");
  return [...leads.values()].filter((l) => l.orgId === org && inScope(scope, l.centerId));
}

function forWrite(viewer: IiosGrantedContext, id: string): StoredLead | Refusal {
  const org = staffOrgOf(viewer);
  if (!org) return { ok: false, reason: "not_staff" };
  const l = leads.get(id);
  if (!l || l.orgId !== org) return { ok: false, reason: "not_found" };
  if (!allows(viewer, "admissions:manage", { centerId: l.centerId }))
    return { ok: false, reason: "access_policy" };
  return l;
}
const refused = (x: unknown): x is Refusal =>
  !!x && typeof x === "object" && "ok" in x && (x as Refusal).ok === false;

function setStage(l: StoredLead, stage: LeadStage, by: string) {
  l.stage = stage;
  l.history.push({ stage, at: new Date().toISOString(), by });
}

// ── hooks for Growth (referral leads) and Billing (first invoice) ─────────────────────────────

export function createReferralLead(input: {
  orgId: string;
  learnerName: string;
  courseCode: string;
  centerId: string;
  referral: NonNullable<StoredLead["referral"]>;
}): string {
  const id = `ADM-${++seq}`;
  const at = new Date().toISOString();
  leads.set(id, {
    id,
    orgId: input.orgId,
    learnerName: input.learnerName,
    courseCode: input.courseCode,
    centerId: input.centerId,
    source: "referral",
    referral: { ...input.referral },
    channel: null,
    needs: [],
    note: "",
    stage: "new",
    history: [{ stage: "new", at, by: "Referral link" }],
    assignedTo: null,
    activities: [],
    invoiceNo: null,
    firstPaymentVnd: null,
    lostReason: null,
    createdAt: at,
  });
  return id;
}
/** Read-only copies for the Growth Engine. */
export const allLeads = (): StoredLead[] => [...leads.values()].map((l) => structuredClone(l));
export const leadsOfOrg = (orgId: string): StoredLead[] =>
  [...leads.values()].filter((l) => l.orgId === orgId).map((l) => structuredClone(l));
export const leadById = (id: string): StoredLead | null => {
  const l = leads.get(id);
  return l ? structuredClone(l) : null;
};

export interface LeadForBilling {
  id: string;
  orgId: string;
  stage: LeadStage;
  learnerName: string;
  courseCode: string;
  centerId: string;
  invoiceNo: string | null;
}
export function leadForBilling(id: string): LeadForBilling | null {
  const l = leads.get(id);
  return l
    ? {
        id: l.id,
        orgId: l.orgId,
        stage: l.stage,
        learnerName: l.learnerName,
        courseCode: l.courseCode,
        centerId: l.centerId,
        invoiceNo: l.invoiceNo,
      }
    : null;
}
/** Partner Commissions: an open lead (not waiting for a first invoice) handed to a partner. */
export function canReferOut(id: string): string | null {
  const l = leads.get(id);
  if (!l) return "lead not found";
  if (!isOpen(l)) return "the lead is closed";
  if (l.stage === "offer") return `first invoice ${l.invoiceNo} is open — void it in Billing first`;
  return null;
}
export function referLeadOut(id: string, partnerName: string, by: string): void {
  const l = leads.get(id);
  if (!l || canReferOut(id)) return;
  l.lostReason = `Referred to partner: ${partnerName}`;
  setStage(l, "lost", by);
}

/** First invoice issued → "offer"; voided (null) → back to "placement". */
export function attachFirstInvoice(id: string, invoiceNo: string | null, by = "Billing"): void {
  const l = leads.get(id);
  if (!l) return;
  l.invoiceNo = invoiceNo;
  if (invoiceNo && l.stage === "placement") setStage(l, "offer", by);
  if (!invoiceNo && l.stage === "offer") setStage(l, "placement", by);
}
/** The first invoice is paid in full: enrolled, with the amount from the invoice. */
export function markLeadPaid(id: string, amountVnd: number, by = "Billing"): void {
  const l = leads.get(id);
  if (!l || l.stage !== "offer") return;
  l.firstPaymentVnd = amountVnd;
  setStage(l, "enrolled", by);
}

// ── validation ──────────────────────────────────────────────────────────────────────────────

const CHANNELS: ContactChannel[] = ["zalo", "phone", "email", "in_person"];
const SOURCES: LeadSource[] = ["walk_in", "website", "event", "phone"];

function draftIssue(orgId: string, d: Parameters<AdmissionsPort["createLead"]>[1]): string | null {
  const name = d.learnerName.trim();
  if (name.length < 2 || name.length > 60) return "name must be 2–60 characters";
  // Synthetic data only: no digits (phone numbers), no e-mail addresses in names or notes.
  if (/\d{4,}|@/.test(name) || /\d{6,}|@/.test(d.note))
    return "no phone numbers or e-mail addresses";
  if (!courses.some((c) => c.orgId === orgId && c.code === d.courseCode)) return "unknown course";
  if (!centers.some((c) => c.orgId === orgId && c.id === d.centerId)) return "unknown center";
  if (!SOURCES.includes(d.source)) return "unknown source";
  if (d.channel !== null && !CHANNELS.includes(d.channel)) return "unknown channel";
  if (d.needs.some((n) => !LEARNING_NEEDS.includes(n))) return "unknown learning need";
  if (d.note.length > 280) return "note: at most 280 characters";
  return null;
}

function settingsIssue(s: ScoringSettings): string | null {
  for (const k of SCORE_KEYS) {
    const v = s.max?.[k];
    if (!Number.isInteger(v) || v < 0 || v > 50) return `${k}: 0–50 points`;
  }
  if (Object.keys(s.max).some((k) => !SCORE_KEYS.includes(k as ScoreKey)))
    return "unknown score part";
  const sum = SCORE_KEYS.reduce((t, k) => t + s.max[k], 0);
  if (sum !== 100) return `the parts must add up to 100 (now ${sum})`;
  if (
    !Number.isInteger(s.warmAt) ||
    !Number.isInteger(s.hotAt) ||
    s.warmAt < 1 ||
    s.hotAt > 99 ||
    s.warmAt >= s.hotAt
  )
    return "warm must be below hot, both 1–99";
  if (!Number.isInteger(s.staleDays) || s.staleDays < 1 || s.staleDays > 60)
    return "stale after 1–60 days";
  return null;
}

// ── port ────────────────────────────────────────────────────────────────────────────────────

export const mockAdmissions: AdmissionsPort = {
  listLeads: (viewer) =>
    withFault("admissions.listLeads", () => {
      const list = scoped(viewer);
      if (!list) return latency<Lead[] | null>(null);
      const now = Date.now();
      return latency(
        list
          .map((l) => view(l, now))
          .sort((a, b) => b.score.total - a.score.total || (a.createdAt < b.createdAt ? 1 : -1)),
      );
    }),

  counselors: (viewer) =>
    withFault("admissions.counselors", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<{ principalId: string; name: string }[] | null>(null);
      return latency(
        counselorsOf(org).map((m) => ({ principalId: m.principalId, name: m.displayName })),
      );
    }),

  createLead: (viewer, draft) =>
    withFault("admissions.createLead", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      if (!centers.some((c) => c.orgId === org && c.id === draft.centerId))
        return refuse("invalid", "unknown center");
      if (!allows(viewer, "admissions:manage", { centerId: draft.centerId }))
        return refuse("access_policy");
      const bad = draftIssue(org, draft);
      if (bad) return refuse("invalid", bad);
      const id = `ADM-${++seq}`;
      const at = new Date().toISOString();
      leads.set(id, {
        id,
        orgId: org,
        learnerName: draft.learnerName.trim(),
        courseCode: draft.courseCode,
        centerId: draft.centerId,
        source: draft.source,
        referral: null,
        channel: draft.channel,
        needs: [...new Set(draft.needs)],
        note: draft.note.trim(),
        stage: "new",
        history: [{ stage: "new", at, by: displayNameOf(viewer) }],
        assignedTo: null,
        activities: [],
        invoiceNo: null,
        firstPaymentVnd: null,
        lostReason: null,
        createdAt: at,
      });
      return ok(id);
    }),

  assign: (viewer, leadId, principalId) =>
    withFault("admissions.assign", () => {
      const l = forWrite(viewer, leadId);
      if (refused(l)) return latency(l);
      if (!counselorsOf(l.orgId).some((m) => m.principalId === principalId))
        return refuse("invalid", "not a staff member of this organization");
      if (!isOpen(l)) return refuse("invalid_step", "the lead is closed");
      l.assignedTo = principalId;
      if (l.stage === "new") setStage(l, "assigned", displayNameOf(viewer));
      return ok();
    }),

  moveStage: (viewer, leadId, stage, reason) =>
    withFault("admissions.moveStage", () => {
      const l = forWrite(viewer, leadId);
      if (refused(l)) return latency(l);
      if (!MANUAL_STAGES.includes(stage))
        return refuse("invalid_step", "offer and enrolled follow the first invoice (Billing)");
      if (l.stage === "enrolled") return refuse("invalid_step", "already enrolled");
      if (l.stage === "offer")
        return refuse(
          "invalid_step",
          `first invoice ${l.invoiceNo} is open — void it in Billing first`,
        );
      if (stage === l.stage) return refuse("invalid_step", "already at this stage");
      if (stage === "assigned" && !l.assignedTo)
        return refuse("invalid", "assign a counselor first");
      if (stage === "lost") {
        if (!reason || reason.trim().length < 3) return refuse("invalid", "give a reason");
        l.lostReason = reason.trim();
      } else l.lostReason = null;
      setStage(l, stage, displayNameOf(viewer));
      return ok();
    }),

  logActivity: (viewer, leadId, kind, text) =>
    withFault("admissions.logActivity", () => {
      const l = forWrite(viewer, leadId);
      if (refused(l)) return latency(l);
      if (!["call", "message", "meeting", "note"].includes(kind))
        return refuse("invalid", "unknown kind");
      const t = text.trim();
      if (t.length < 2 || t.length > 280) return refuse("invalid", "2–280 characters");
      if (/\d{6,}|@/.test(t)) return refuse("invalid", "no phone numbers or e-mail addresses");
      l.activities.push({
        id: `${l.id}-A${l.activities.length + 1}`,
        at: new Date().toISOString(),
        by: displayNameOf(viewer),
        kind,
        text: t,
      });
      return ok();
    }),

  getDashboard: (viewer) =>
    withFault("admissions.getDashboard", () => {
      const list = scoped(viewer);
      if (!list) return latency<AdmissionsDashboard | null>(null);
      const org = staffOrgOf(viewer)!;
      const s = settingsOf(org);
      const now = Date.now();
      const reached = (i: number) => list.filter((l) => reachedIndex(l) >= i).length;
      const open = list.filter(isOpen);
      const views = open.map((l) => view(l, now));
      const fr = list.map(firstResponseHours).filter((x): x is number => x !== null);
      const sources: LeadSource[] = ["referral", "walk_in", "website", "event", "phone"];
      return latency<AdmissionsDashboard>({
        total: list.length,
        open: open.length,
        enrolled: list.filter((l) => l.stage === "enrolled").length,
        lost: list.filter((l) => l.stage === "lost").length,
        byStage: [...FUNNEL, "lost" as LeadStage].map((stage) => ({
          stage,
          count: list.filter((l) => l.stage === stage).length,
        })),
        conversions: FUNNEL.slice(1).map((to, i) => ({
          from: FUNNEL[i],
          to,
          ...ratio(reached(i + 1), reached(i)),
        })),
        leadToEnrolled: ratio(reached(stageIndex("enrolled")), list.length),
        firstResponse: { avgHours: avg(fr), measured: fr.length, of: list.length },
        stale: list.filter((l) => isStale(l, s, now)).length,
        staleDays: s.staleDays,
        bands: {
          hot: views.filter((v) => v.score.band === "hot").length,
          warm: views.filter((v) => v.score.band === "warm").length,
          cold: views.filter((v) => v.score.band === "cold").length,
        },
        bySource: sources.map((source) => {
          const xs = list.filter((l) => l.source === source);
          return {
            source,
            leads: xs.length,
            ...ratio(xs.filter((l) => l.stage === "enrolled").length, xs.length),
          };
        }),
        counselors: counselorsOf(org).map((m) => {
          const mine = list.filter((l) => l.assignedTo === m.principalId);
          const frs = mine.map(firstResponseHours).filter((x): x is number => x !== null);
          const enrolled = mine.filter((l) => l.stage === "enrolled").length;
          return {
            principalId: m.principalId,
            name: m.displayName,
            assigned: mine.length,
            contacted: mine.filter((l) => reachedIndex(l) >= stageIndex("contacted")).length,
            enrolled,
            conversion: ratio(enrolled, mine.length),
            avgFirstResponseHours: avg(frs),
            stale: mine.filter((l) => isStale(l, s, now)).length,
          };
        }),
      });
    }),

  getSettings: (viewer) =>
    withFault("admissions.getSettings", () => {
      const org = staffOrgOf(viewer);
      return latency(org ? settingsOf(org) : null);
    }),

  updateSettings: (viewer, next) =>
    withFault("admissions.updateSettings", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      if (!allows(viewer, "admissions:manage")) return refuse("access_policy");
      const bad = settingsIssue(next);
      if (bad) return refuse("invalid", bad);
      settings.set(org, {
        max: { ...next.max },
        hotAt: next.hotAt,
        warmAt: next.warmAt,
        staleDays: next.staleDays,
      });
      return ok();
    }),
};

reset();
