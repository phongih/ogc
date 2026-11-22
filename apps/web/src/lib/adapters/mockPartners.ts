/*
 * Partner Commissions — MOCK adapter (SYNTHETIC). Owner decisions 22/11: see
 * packages/contracts/src/partners.ts. Leads go out from Admissions; partner suggestions are ranked
 * by fit for the learner, never by commission; staff record what partners report, an Org Admin
 * activates tier rules and approves entries (never their own step); signals only suggest; every
 * step is appended to the activity log. Money is a mock receivable.
 */
import type {
  ActivityEntry,
  CommissionCycle,
  CommissionEntry,
  CommissionStatus,
  DecisionSignal,
  IiosGrantedContext,
  Partner,
  PartnerFit,
  PartnerSummary,
  PartnersPort,
  PartnersResult,
  SignalState,
  TierRule,
  TierRuleDraft,
} from "@ogc/contracts";
import { commissionFor, tierIndexFor, tierRuleIssue } from "@ogc/contracts";
import { organizations, centers } from "../../fixtures/directory";
import { members } from "../../fixtures/personas";
import { allows } from "./accessPolicy";
import { displayNameOf, staffOrgOf } from "./viewer";
import { canReferOut, leadById, referLeadOut } from "./mockAdmissions";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
type Refusal = Exclude<PartnersResult, { ok: true }>;
const refuse = (reason: Refusal["reason"], detail?: string) =>
  latency<PartnersResult>({ ok: false, reason, ...(detail ? { detail } : {}) });
const ok = () => latency<PartnersResult>({ ok: true });

const DAY = 86_400_000;
const TZ = 7 * 3_600_000; // center time (Asia/Ho_Chi_Minh)
export const STALE_DAYS = 10;
export const REJECTION_ALERT_PCT = 25;
export const REJECTION_MIN_DECIDED = 4;
export const SNOOZE_DAYS = 7;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── center-time cycles ────────────────────────────────────────────────────────────────────────
function cycleOf(cycle: CommissionCycle, t: number) {
  const d = new Date(t + TZ);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const startM = cycle === "monthly" ? m : m - (m % 3);
  const len = cycle === "monthly" ? 1 : 3;
  return {
    key: `${cycle}:${y}-${startM}`,
    label: cycle === "monthly" ? `${MONTHS[m]} ${y}` : `Q${startM / 3 + 1} ${y}`,
    start: Date.UTC(y, startM, 1) - TZ,
    end: Date.UTC(y, startM + len, 1) - TZ, // exclusive
  };
}
const fmtDate = (t: number) => {
  const d = new Date(t + TZ);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const vnd = (n: number) => `${new Intl.NumberFormat("vi-VN").format(n)} ₫`;

// ── state ───────────────────────────────────────────────────────────────────────────────────
interface StoredPartner {
  id: string;
  orgId: string;
  name: string;
  courses: string[];
  nearCenterIds: string[];
  retentionPct: number;
  settlementDays: number;
}
interface StoredRule extends Omit<TierRule, "mine"> {
  proposedByPrincipal: string;
}
interface StoredEntry {
  id: string;
  orgId: string;
  partnerId: string;
  leadId: string | null;
  leadRefCode: string;
  learnerDisplayName: string;
  courseCode: string;
  referredAt: string;
  expiresAt: string;
  enrolledAt: string | null;
  enrolledBy: string | null; // principal
  status: CommissionStatus;
  appliedRuleId: string | null;
  lockedAmountVnd: number | null; // set on approval
  lockedTierIndex: number | null;
  approvedAt: string | null;
  dueDate: string | null;
  rejectReason: string | null;
  settledBatchId: string | null;
  updatedBy: string;
  updatedAt: string;
}
interface SignalMark {
  state: Exclude<SignalState, "open">;
  note: string | null;
  until: string | null; // snoozed until
}

const partners = new Map<string, StoredPartner>();
const rules = new Map<string, StoredRule>();
const entries = new Map<string, StoredEntry>();
const marks = new Map<string, SignalMark>();
let activity: (ActivityEntry & { orgId: string })[] = [];
let seq = { rule: 0, entry: 0, ref: 1000 };

const NOVA = organizations[0].id;
const principalOf = (name: string) =>
  members.find((m) => m.displayName === name)?.principalId ?? name;
const SAM = "Sam (Org Staff)";
const OLIVIA = "Olivia (Org Admin)";

function log(
  orgId: string,
  by: string,
  action: string,
  subject: string,
  detail: string | null = null,
) {
  activity.push({ orgId, at: new Date().toISOString(), by, action, subject, detail });
}

function addRule(r: Omit<StoredRule, "id">): StoredRule {
  const rule = { ...r, id: `TR-${++seq.rule}` };
  rules.set(rule.id, rule);
  return rule;
}

function seed() {
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const center = (i: number) => centers[i].id;
  const ps: StoredPartner[] = [
    {
      id: "PTN-LOTUS",
      orgId: NOVA,
      name: "Lotus English — Binh Thanh",
      courses: ["ENG-A2", "ENG-B1"],
      nearCenterIds: [center(0), center(1)],
      retentionPct: 82,
      settlementDays: 15,
    },
    {
      id: "PTN-SAOMAI",
      orgId: NOVA,
      name: "Sao Mai IELTS Academy — District 3",
      courses: ["IELTS-B2", "ENG-B1"],
      nearCenterIds: [center(0)],
      retentionPct: 74,
      settlementDays: 20,
    },
    {
      id: "PTN-BRIDGE",
      orgId: NOVA,
      name: "Hanoi Bridge English — Dong Da",
      courses: ["ENG-A2"],
      nearCenterIds: [center(2)],
      retentionPct: 68,
      settlementDays: 15,
    },
  ];
  for (const p of ps) partners.set(p.id, p);
  const base = {
    status: "active" as const,
    dataClassification: "confidential" as const,
    proposedBy: SAM,
    proposedByPrincipal: principalOf(SAM),
    proposedAt: iso(now - 120 * DAY),
    decidedBy: OLIVIA,
    decidedAt: iso(now - 119 * DAY),
  };
  const lotus = addRule({
    ...base,
    partnerId: "PTN-LOTUS",
    version: 1,
    cycle: "monthly",
    mode: "progressive",
    tiers: [
      { minCount: 1, amountVnd: 1_000_000 },
      { minCount: 4, amountVnd: 2_000_000 },
      { minCount: 8, amountVnd: 3_000_000 },
    ],
    attributionWindowDays: 60,
    clawbackWindowDays: 7,
  });
  const saomai = addRule({
    ...base,
    partnerId: "PTN-SAOMAI",
    version: 1,
    cycle: "quarterly",
    mode: "retroactive",
    tiers: [
      { minCount: 1, amountVnd: 1_500_000 },
      { minCount: 4, amountVnd: 2_500_000 },
    ],
    attributionWindowDays: 30,
    clawbackWindowDays: 14,
  });
  // Waiting for an Org Admin: Sao Mai v2 adds a third tier.
  addRule({
    ...base,
    status: "pending",
    partnerId: "PTN-SAOMAI",
    version: 2,
    cycle: "quarterly",
    mode: "retroactive",
    tiers: [
      { minCount: 1, amountVnd: 1_500_000 },
      { minCount: 4, amountVnd: 2_500_000 },
      { minCount: 8, amountVnd: 3_500_000 },
    ],
    attributionWindowDays: 30,
    clawbackWindowDays: 14,
    proposedAt: iso(now - 2 * DAY),
    decidedBy: null,
    decidedAt: null,
  });
  const bridge = addRule({
    ...base,
    partnerId: "PTN-BRIDGE",
    version: 1,
    cycle: "monthly",
    mode: "progressive",
    tiers: [
      { minCount: 1, amountVnd: 800_000 },
      { minCount: 5, amountVnd: 1_500_000 },
    ],
    attributionWindowDays: 30,
    clawbackWindowDays: 7,
  });

  const monthStart = cycleOf("monthly", now).start;
  const inMonth = (h: number) => Math.min(now - 3_600_000, monthStart + h * 3_600_000);
  const lastMonth = cycleOf("monthly", monthStart - DAY).start;
  type Seed = {
    p: string;
    rule: StoredRule;
    name: string;
    course: string;
    referred: number;
    enrolled?: number;
    status: CommissionStatus;
    approvedAgo?: number;
    batch?: string;
    reason?: string;
  };
  const S: Seed[] = [
    // Lotus — 3 enrolments this month (1 more lifts the rate), each referred a few days before it
    // enrolled; 2 still referred; last month settled except one approved entry past its due date.
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Quan B.",
      course: "ENG-A2",
      referred: inMonth(10) - 6 * DAY,
      enrolled: inMonth(10),
      status: "enrolled",
    },
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Nhi P.",
      course: "ENG-B1",
      referred: inMonth(30) - 5 * DAY,
      enrolled: inMonth(30),
      status: "enrolled",
    },
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Dat H.",
      course: "ENG-A2",
      referred: inMonth(60) - 4 * DAY,
      enrolled: inMonth(60),
      status: "enrolled",
    },
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Mai L.",
      course: "ENG-B1",
      referred: now - 5 * DAY,
      status: "referred",
    },
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Son K.",
      course: "ENG-A2",
      referred: now - 12 * DAY,
      status: "referred",
    },
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Ha T.",
      course: "ENG-A2",
      referred: now - 60 * DAY,
      enrolled: lastMonth + 2 * DAY,
      status: "paid",
      approvedAgo: 40,
      batch: "ST-LOTUS-01",
    },
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Long V.",
      course: "ENG-B1",
      referred: now - 58 * DAY,
      enrolled: lastMonth + 4 * DAY,
      status: "paid",
      approvedAgo: 40,
      batch: "ST-LOTUS-01",
    },
    {
      p: "PTN-LOTUS",
      rule: lotus,
      name: "Trang N.",
      course: "ENG-A2",
      referred: now - 55 * DAY,
      enrolled: lastMonth + 6 * DAY,
      status: "approved",
      approvedAgo: 30,
    },
    // Sao Mai — retroactive quarter, a stale referral close to its attribution end, two rejections.
    {
      p: "PTN-SAOMAI",
      rule: saomai,
      name: "Khanh D.",
      course: "IELTS-B2",
      referred: now - 26 * DAY,
      enrolled: now - 20 * DAY,
      status: "enrolled",
    },
    {
      p: "PTN-SAOMAI",
      rule: saomai,
      name: "Phuong A.",
      course: "IELTS-B2",
      referred: now - 24 * DAY,
      enrolled: now - 16 * DAY,
      status: "enrolled",
    },
    {
      p: "PTN-SAOMAI",
      rule: saomai,
      name: "Tuan M.",
      course: "ENG-B1",
      referred: now - 25 * DAY,
      status: "referred",
    },
    {
      p: "PTN-SAOMAI",
      rule: saomai,
      name: "Lan C.",
      course: "IELTS-B2",
      referred: now - 22 * DAY,
      status: "rejected",
      reason: "already a learner at the partner",
    },
    {
      p: "PTN-SAOMAI",
      rule: saomai,
      name: "Bich T.",
      course: "IELTS-B2",
      referred: now - 19 * DAY,
      status: "rejected",
      reason: "did not enrol within the window",
    },
    // Hanoi Bridge — one new referral, one paid last month.
    {
      p: "PTN-BRIDGE",
      rule: bridge,
      name: "Hoa G.",
      course: "ENG-A2",
      referred: now - 3 * DAY,
      status: "referred",
    },
    {
      p: "PTN-BRIDGE",
      rule: bridge,
      name: "Vinh Q.",
      course: "ENG-A2",
      referred: now - 50 * DAY,
      enrolled: lastMonth + 3 * DAY,
      status: "paid",
      approvedAgo: 35,
      batch: "ST-BRIDGE-01",
    },
  ];
  for (const s of S) {
    const e: StoredEntry = {
      id: `CE-${++seq.entry}`,
      orgId: NOVA,
      partnerId: s.p,
      leadId: null,
      leadRefCode: `LR-${++seq.ref}`,
      learnerDisplayName: s.name,
      courseCode: s.course,
      referredAt: iso(s.referred),
      expiresAt: iso(s.referred + s.rule.attributionWindowDays * DAY),
      enrolledAt: s.enrolled ? iso(s.enrolled) : null,
      enrolledBy: s.enrolled ? principalOf(SAM) : null,
      status: s.status,
      appliedRuleId: s.enrolled ? s.rule.id : null,
      lockedAmountVnd: null,
      lockedTierIndex: null,
      approvedAt: s.approvedAgo ? iso(now - s.approvedAgo * DAY) : null,
      dueDate: null,
      rejectReason: s.reason ?? null,
      settledBatchId: s.batch ?? null,
      updatedBy: s.status === "approved" || s.status === "paid" ? OLIVIA : SAM,
      updatedAt: iso(now - DAY),
    };
    entries.set(e.id, e);
  }
  // Lock the amounts of approved / paid seed entries as their approval would have.
  for (const e of entries.values())
    if (e.status === "approved" || e.status === "paid") {
      const c = computed(e, now);
      e.lockedAmountVnd = c.amountVnd;
      e.lockedTierIndex = c.tierIndex;
      const p = partners.get(e.partnerId)!;
      e.dueDate = new Date(Date.parse(e.approvedAt!) + p.settlementDays * DAY).toISOString();
    }
}

function reset() {
  partners.clear();
  rules.clear();
  entries.clear();
  marks.clear();
  activity = [];
  seq = { rule: 0, entry: 0, ref: 1000 };
  seed();
}
sessionStore.onReset(reset);
export const __resetPartnersForTests = reset;
registerPersistent("partners", {
  dump: () => ({ partners, rules, entries, marks, activity, seq }),
  load: (raw) => {
    const r = raw as {
      partners?: unknown;
      rules?: unknown;
      entries?: unknown;
      marks?: unknown;
      activity?: typeof activity;
      seq?: typeof seq;
    };
    refill(partners, r.partners);
    refill(rules, r.rules);
    refill(entries, r.entries);
    refill(marks, r.marks);
    if (Array.isArray(r.activity)) activity = r.activity;
    if (r.seq) seq = r.seq;
  },
});

// ── derived ─────────────────────────────────────────────────────────────────────────────────
const activeRule = (pid: string) =>
  [...rules.values()].find((r) => r.partnerId === pid && r.status === "active") ?? null;
const counted = (s: CommissionStatus) => s === "enrolled" || s === "approved" || s === "paid";

/** Position, cycle count and amount of an enrolled entry under the rule it was enrolled with. */
function computed(e: StoredEntry, now: number) {
  const rule = e.appliedRuleId ? rules.get(e.appliedRuleId)! : null;
  if (!rule || !e.enrolledAt)
    return {
      rule: null,
      cycle: null,
      tierIndex: null,
      amountVnd: null,
      provisional: false,
      approvableFrom: null as number | null,
    };
  const t = Date.parse(e.enrolledAt);
  const cycle = cycleOf(rule.cycle, t);
  const same = [...entries.values()]
    .filter(
      (x) =>
        x.partnerId === e.partnerId &&
        counted(x.status) &&
        x.enrolledAt &&
        cycleOf(rule.cycle, Date.parse(x.enrolledAt)).key === cycle.key,
    )
    .sort(
      (a, b) => Date.parse(a.enrolledAt!) - Date.parse(b.enrolledAt!) || a.id.localeCompare(b.id),
    );
  const position = same.findIndex((x) => x.id === e.id) + 1;
  const c = commissionFor(rule, position, same.length);
  const provisional = rule.mode === "retroactive" && now < cycle.end;
  const approvableFrom = Math.max(
    t + rule.clawbackWindowDays * DAY,
    rule.mode === "retroactive" ? cycle.end : 0,
  );
  return {
    rule,
    cycle,
    tierIndex: c.tierIndex,
    amountVnd: c.amountVnd,
    provisional,
    approvableFrom,
  };
}

function view(e: StoredEntry, now: number): CommissionEntry {
  const c = computed(e, now);
  const locked = e.status === "approved" || e.status === "paid";
  return {
    id: e.id,
    partnerId: e.partnerId,
    partnerName: partners.get(e.partnerId)?.name ?? "Partner",
    leadRefCode: e.leadRefCode,
    learnerDisplayName: e.learnerDisplayName,
    courseCode: e.courseCode,
    referredAt: e.referredAt,
    expiresAt: e.expiresAt,
    enrolledAt: e.enrolledAt,
    status: e.status,
    cycleLabel: c.cycle?.label ?? null,
    appliedRuleVersion: c.rule?.version ?? null,
    appliedTierIndex: locked ? e.lockedTierIndex : c.tierIndex,
    amountVnd: locked ? e.lockedAmountVnd : c.amountVnd,
    provisional: !locked && c.provisional,
    approvableFrom:
      e.status === "enrolled" && c.approvableFrom ? new Date(c.approvableFrom).toISOString() : null,
    dueDate: e.dueDate,
    rejectReason: e.rejectReason,
    settledBatchId: e.settledBatchId,
    updatedBy: e.updatedBy,
    updatedAt: e.updatedAt,
    enrolledBy: e.enrolledBy,
  };
}

const ruleView = (r: StoredRule, viewer: IiosGrantedContext): TierRule => {
  const { proposedByPrincipal, ...rest } = r;
  return {
    ...rest,
    tiers: r.tiers.map((t) => ({ ...t })),
    mine: proposedByPrincipal === viewer.principalId,
  };
};

function summaryOf(p: StoredPartner, now: number): PartnerSummary {
  const list = [...entries.values()].filter((e) => e.partnerId === p.id).map((e) => view(e, now));
  const by = (s: CommissionStatus) => list.filter((e) => e.status === s);
  const rule = activeRule(p.id);
  const cycle = rule ? cycleOf(rule.cycle, now) : null;
  const cycleCount = cycle
    ? list.filter(
        (e) =>
          counted(e.status) &&
          e.enrolledAt &&
          Date.parse(e.enrolledAt) >= cycle.start &&
          Date.parse(e.enrolledAt) < cycle.end,
      ).length
    : 0;
  const curIdx = rule && cycleCount > 0 ? tierIndexFor(rule.tiers, cycleCount) : null;
  const next = rule ? (rule.tiers.find((t) => t.minCount > cycleCount) ?? null) : null;
  return {
    partnerId: p.id,
    partnerName: p.name,
    referred: by("referred").length,
    enrolled: by("enrolled").length,
    approved: by("approved").length,
    paid: by("paid").length,
    rejected: by("rejected").length,
    receivedVnd: by("paid").reduce((t, e) => t + (e.amountVnd ?? 0), 0),
    awaitingPaymentVnd: by("approved").reduce((t, e) => t + (e.amountVnd ?? 0), 0),
    overdueVnd: by("approved")
      .filter((e) => e.dueDate && Date.parse(e.dueDate) < now)
      .reduce((t, e) => t + (e.amountVnd ?? 0), 0),
    cycleCount,
    currentTierAmountVnd: curIdx === null ? null : rule!.tiers[curIdx].amountVnd,
    nextTier: next ? { at: next.minCount, amountVnd: next.amountVnd } : null,
  };
}

function signalsOf(orgId: string, now: number): DecisionSignal[] {
  const out: Omit<DecisionSignal, "state" | "note">[] = [];
  for (const p of [...partners.values()].filter((x) => x.orgId === orgId)) {
    const rule = activeRule(p.id);
    const list = [...entries.values()].filter((e) => e.partnerId === p.id);
    const s = summaryOf(p, now);
    const referred = list.filter((e) => e.status === "referred");
    // Near the next tier — follow up on learners already referred (no new routing by money).
    if (
      rule &&
      s.nextTier &&
      s.cycleCount > 0 &&
      s.nextTier.at - s.cycleCount <= 2 &&
      referred.length > 0
    ) {
      const cycle = cycleOf(rule.cycle, now);
      out.push({
        id: `near_next_tier:${p.id}:${cycle.key}:${s.nextTier.at}`,
        rule: "near_next_tier",
        partnerId: p.id,
        partnerName: p.name,
        message: `${p.name} has ${s.cycleCount} enrolments in ${cycle.label}; from enrolment no. ${s.nextTier.at} the rate goes from ${vnd(s.currentTierAmountVnd ?? 0)} to ${vnd(s.nextTier.amountVnd)} per learner. ${referred.length} referred learner(s) are not confirmed yet — check with the partner.`,
        evidence: referred.map(
          (e) =>
            `${e.learnerDisplayName} (${e.leadRefCode}) referred ${fmtDate(Date.parse(e.referredAt))}`,
        ),
      });
    }
    // Stale referrals.
    const stale = referred
      .filter((e) => now - Date.parse(e.referredAt) > STALE_DAYS * DAY)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (stale.length) {
      const first = Math.min(...stale.map((e) => Date.parse(e.expiresAt)));
      out.push({
        id: `stale_referral:${p.id}:${stale.map((e) => e.id).join(",")}`,
        rule: "stale_referral",
        partnerId: p.id,
        partnerName: p.name,
        message: `${stale.length} learner(s) handed to ${p.name} more than ${STALE_DAYS} days ago have no update; the earliest attribution window ${first < now ? "ended" : "ends"} on ${fmtDate(first)}. Reconcile with the partner.`,
        evidence: stale.map(
          (e) =>
            `${e.learnerDisplayName} (${e.leadRefCode}) referred ${fmtDate(Date.parse(e.referredAt))}, window ends ${fmtDate(Date.parse(e.expiresAt))}`,
        ),
      });
    }
    // High rejection rate in the last 30 days.
    const recent = list.filter((e) =>
      e.status === "rejected"
        ? now - Date.parse(e.updatedAt) <= 30 * DAY
        : !!e.enrolledAt && now - Date.parse(e.enrolledAt) <= 30 * DAY,
    );
    const rejected = recent.filter((e) => e.status === "rejected");
    if (
      recent.length >= REJECTION_MIN_DECIDED &&
      (rejected.length / recent.length) * 100 > REJECTION_ALERT_PCT
    ) {
      const pct = Math.round((rejected.length / recent.length) * 100);
      out.push({
        id: `high_rejection_rate:${p.id}:${rejected.map((e) => e.id).join(",")}`,
        rule: "high_rejection_rate",
        partnerId: p.id,
        partnerName: p.name,
        message: `${rejected.length} of ${recent.length} referrals decided at ${p.name} in the last 30 days were rejected (${pct}%, above ${REJECTION_ALERT_PCT}%). Check how leads are matched before referring more.`,
        evidence: rejected.map((e) => `${e.learnerDisplayName}: ${e.rejectReason}`),
      });
    }
    // Overdue settlement.
    const overdue = list
      .filter((e) => e.status === "approved" && e.dueDate && Date.parse(e.dueDate) < now)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (overdue.length) {
      const total = overdue.reduce((t, e) => t + (e.lockedAmountVnd ?? 0), 0);
      out.push({
        id: `overdue_settlement:${p.id}:${overdue.map((e) => e.id).join(",")}`,
        rule: "overdue_settlement",
        partnerId: p.id,
        partnerName: p.name,
        message: `${p.name} has ${vnd(total)} approved but not paid after the due date.`,
        evidence: overdue.map(
          (e) =>
            `${e.learnerDisplayName} · ${vnd(e.lockedAmountVnd ?? 0)} · due ${fmtDate(Date.parse(e.dueDate!))}`,
        ),
      });
    }
  }
  const order = { open: 0, snoozed: 1, followed: 2, dismissed: 3 } as const;
  return out
    .map((x) => {
      const m = marks.get(x.id);
      const state: SignalState =
        !m || (m.state === "snoozed" && m.until && Date.parse(m.until) <= now) ? "open" : m.state;
      return { ...x, state, note: state === "open" ? null : (m?.note ?? null) };
    })
    .sort((a, b) => order[a.state] - order[b.state]);
}

reset(); // after the helpers above (the seed computes amounts with them)

// ── access ──────────────────────────────────────────────────────────────────────────────────
function reader(viewer: IiosGrantedContext): string | null {
  const org = staffOrgOf(viewer);
  return org && allows(viewer, "partners:manage") ? org : null;
}
function writer(viewer: IiosGrantedContext): string | Refusal {
  const org = staffOrgOf(viewer);
  if (!org) return { ok: false, reason: "not_staff" };
  if (!allows(viewer, "partners:manage")) return { ok: false, reason: "access_policy" };
  return org;
}
const refused = (x: unknown): x is Refusal =>
  !!x && typeof x === "object" && "ok" in x && (x as Refusal).ok === false;
function entryFor(viewer: IiosGrantedContext, id: string): StoredEntry | Refusal {
  const org = writer(viewer);
  if (refused(org)) return org;
  const e = entries.get(id);
  if (!e || e.orgId !== org) return { ok: false, reason: "not_found" };
  return e;
}
const touch = (e: StoredEntry, viewer: IiosGrantedContext) => {
  e.updatedBy = displayNameOf(viewer);
  e.updatedAt = new Date().toISOString();
};

// ── port ────────────────────────────────────────────────────────────────────────────────────
export const mockPartners: PartnersPort = {
  getOverview: (viewer) =>
    withFault("partners.overview", () => {
      const org = reader(viewer);
      if (!org) return latency(null);
      const now = Date.now();
      const sums = [...partners.values()]
        .filter((p) => p.orgId === org)
        .map((p) => summaryOf(p, now));
      return latency({
        kpis: {
          receivedVnd: sums.reduce((t, s) => t + s.receivedVnd, 0),
          awaitingPaymentVnd: sums.reduce((t, s) => t + s.awaitingPaymentVnd, 0),
          awaitingEnrolment: sums.reduce((t, s) => t + s.referred, 0),
          nextTierUpliftVnd: sums.reduce(
            (t, s) =>
              t +
              (s.nextTier && s.nextTier.at - s.cycleCount === 1 && s.currentTierAmountVnd !== null
                ? s.nextTier.amountVnd - s.currentTierAmountVnd
                : 0),
            0,
          ),
        },
        partners: sums,
        signals: signalsOf(org, now),
        canManage: true,
        isOrgAdmin: !!viewer.orgAdmin,
      });
    }),

  listPartners: (viewer) =>
    withFault("partners.list", () => {
      const org = reader(viewer);
      if (!org) return latency(null);
      return latency(
        [...partners.values()]
          .filter((p) => p.orgId === org)
          .map((p): Partner => {
            const versions = [...rules.values()]
              .filter((r) => r.partnerId === p.id)
              .sort((a, b) => b.version - a.version);
            const act = versions.find((r) => r.status === "active");
            const pend = versions.find((r) => r.status === "pending");
            return {
              id: p.id,
              name: p.name,
              courses: [...p.courses],
              nearCenters: p.nearCenterIds.map(
                (id) => centers.find((c) => c.id === id)?.name ?? id,
              ),
              retentionPct: p.retentionPct,
              settlementDays: p.settlementDays,
              rule: act ? ruleView(act, viewer) : null,
              pendingRule: pend ? ruleView(pend, viewer) : null,
              history: versions.map((r) => ruleView(r, viewer)),
            };
          }),
      );
    }),

  listEntries: (viewer) =>
    withFault("partners.entries", () => {
      const org = reader(viewer);
      if (!org) return latency(null);
      const now = Date.now();
      return latency(
        [...entries.values()]
          .filter((e) => e.orgId === org)
          .sort((a, b) => Date.parse(b.referredAt) - Date.parse(a.referredAt))
          .map((e) => view(e, now)),
      );
    }),

  listActivity: (viewer) =>
    withFault("partners.activity", () => {
      const org = reader(viewer);
      if (!org) return latency(null);
      return latency(
        activity
          .filter((a) => a.orgId === org)
          .map(({ orgId: _o, ...a }) => a)
          .reverse(),
      );
    }),

  suggestPartners: (viewer, leadId) =>
    withFault("partners.suggest", () => {
      const org = reader(viewer);
      if (!org) return latency(null);
      const l = leadById(leadId);
      if (!l || l.orgId !== org) return latency(null);
      const fits = [...partners.values()]
        .filter((p) => p.orgId === org)
        .map((p): PartnerFit => {
          const teaches = p.courses.includes(l.courseCode);
          const near = p.nearCenterIds.includes(l.centerId);
          const rule = activeRule(p.id);
          const reasons = [
            teaches ? `teaches ${l.courseCode}` : `does not teach ${l.courseCode}`,
            near ? "near the learner's center" : "not near the learner's center",
            `${p.retentionPct}% of referred learners still learning after 3 months`,
          ];
          return {
            partnerId: p.id,
            partnerName: p.name,
            fits: teaches,
            reasons,
            score: (teaches ? 50 : 0) + (near ? 30 : 0) + Math.round(p.retentionPct * 0.2),
            commissionInfo: rule
              ? `${vnd(rule.tiers[0].amountVnd)}–${vnd(rule.tiers[rule.tiers.length - 1].amountVnd)} per learner (${rule.mode}, ${rule.cycle})`
              : null,
          };
        })
        // Fit for the learner only — the commission is never part of the order.
        .sort(
          (a, b) =>
            Number(b.fits) - Number(a.fits) ||
            b.score - a.score ||
            a.partnerName.localeCompare(b.partnerName),
        );
      return latency(fits);
    }),

  referLead: (viewer, leadId, partnerId) =>
    withFault("partners.refer", () => {
      const org = writer(viewer);
      if (refused(org)) return latency(org);
      const l = leadById(leadId);
      const p = partners.get(partnerId);
      if (!l || l.orgId !== org || !p || p.orgId !== org) return refuse("not_found");
      if (!allows(viewer, "admissions:manage", { centerId: l.centerId }))
        return refuse("access_policy");
      const why = canReferOut(leadId);
      if (why) return refuse("invalid_step", why);
      if ([...entries.values()].some((e) => e.leadId === leadId))
        return refuse("invalid_step", "this lead was already referred to a partner");
      if (!p.courses.includes(l.courseCode))
        return refuse("invalid", `${p.name} does not teach ${l.courseCode}`);
      const rule = activeRule(p.id);
      if (!rule) return refuse("invalid_step", `${p.name} has no active tier rule`);
      const now = Date.now();
      const e: StoredEntry = {
        id: `CE-${++seq.entry}`,
        orgId: org,
        partnerId,
        leadId,
        leadRefCode: `LR-${++seq.ref}`,
        learnerDisplayName: l.learnerName,
        courseCode: l.courseCode,
        referredAt: new Date(now).toISOString(),
        expiresAt: new Date(now + rule.attributionWindowDays * DAY).toISOString(),
        enrolledAt: null,
        enrolledBy: null,
        status: "referred",
        appliedRuleId: null,
        lockedAmountVnd: null,
        lockedTierIndex: null,
        approvedAt: null,
        dueDate: null,
        rejectReason: null,
        settledBatchId: null,
        updatedBy: displayNameOf(viewer),
        updatedAt: new Date(now).toISOString(),
      };
      entries.set(e.id, e);
      referLeadOut(leadId, p.name, displayNameOf(viewer));
      log(
        org,
        displayNameOf(viewer),
        "referred",
        `${e.learnerDisplayName} (${e.leadRefCode}) → ${p.name}`,
        `${e.courseCode}; window ends ${fmtDate(Date.parse(e.expiresAt))}`,
      );
      return ok();
    }),

  markEnrolled: (viewer, entryId) =>
    withFault("partners.enrolled", () => {
      const e = entryFor(viewer, entryId);
      if (refused(e)) return latency(e);
      if (e.status !== "referred") return refuse("invalid_step", `already ${e.status}`);
      const now = Date.now();
      if (now > Date.parse(e.expiresAt))
        return refuse(
          "invalid_step",
          `the attribution window ended on ${fmtDate(Date.parse(e.expiresAt))} — reject it instead`,
        );
      const rule = activeRule(e.partnerId);
      if (!rule) return refuse("invalid_step", "the partner has no active tier rule");
      e.status = "enrolled";
      e.enrolledAt = new Date(now).toISOString();
      e.enrolledBy = viewer.principalId;
      e.appliedRuleId = rule.id; // snapshot: the rule in force when the enrolment is recorded
      touch(e, viewer);
      const c = computed(e, now);
      log(
        e.orgId,
        displayNameOf(viewer),
        "enrolment recorded",
        `${e.learnerDisplayName} (${e.leadRefCode})`,
        `rule v${rule.version} · tier ${c.tierIndex} · ${vnd(c.amountVnd ?? 0)}${c.provisional ? " (provisional)" : ""}`,
      );
      return ok();
    }),

  reject: (viewer, entryId, reason) =>
    withFault("partners.reject", () => {
      const e = entryFor(viewer, entryId);
      if (refused(e)) return latency(e);
      if (e.status !== "referred" && e.status !== "enrolled")
        return refuse("invalid_step", `cannot reject an entry that is ${e.status}`);
      const r = reason.trim();
      if (r.length < 3 || r.length > 200)
        return refuse("invalid", "give a reason (3–200 characters)");
      e.status = "rejected";
      e.rejectReason = r;
      touch(e, viewer);
      log(
        e.orgId,
        displayNameOf(viewer),
        "rejected",
        `${e.learnerDisplayName} (${e.leadRefCode})`,
        r,
      );
      return ok();
    }),

  approve: (viewer, entryId) =>
    withFault("partners.approve", () => {
      const e = entryFor(viewer, entryId);
      if (refused(e)) return latency(e);
      if (!viewer.orgAdmin) return refuse("not_org_admin");
      if (e.status !== "enrolled")
        return refuse("invalid_step", `cannot approve an entry that is ${e.status}`);
      if (e.enrolledBy === viewer.principalId)
        return refuse("own_step", "you recorded this enrolment — another person approves it");
      const now = Date.now();
      const c = computed(e, now);
      if (c.approvableFrom && now < c.approvableFrom)
        return refuse(
          "invalid_step",
          `not before ${fmtDate(c.approvableFrom)} (${c.rule?.mode === "retroactive" ? "cycle end / clawback" : "clawback window"})`,
        );
      e.status = "approved";
      e.lockedAmountVnd = c.amountVnd;
      e.lockedTierIndex = c.tierIndex;
      e.approvedAt = new Date(now).toISOString();
      e.dueDate = new Date(now + partners.get(e.partnerId)!.settlementDays * DAY).toISOString();
      touch(e, viewer);
      log(
        e.orgId,
        displayNameOf(viewer),
        "approved",
        `${e.learnerDisplayName} (${e.leadRefCode})`,
        `${vnd(c.amountVnd ?? 0)} · tier ${c.tierIndex} · due ${fmtDate(Date.parse(e.dueDate))}`,
      );
      return ok();
    }),

  markPaid: (viewer, entryId, batchId) =>
    withFault("partners.paid", () => {
      const e = entryFor(viewer, entryId);
      if (refused(e)) return latency(e);
      if (e.status !== "approved")
        return refuse("invalid_step", "only an approved entry can be paid");
      const b = batchId.trim();
      if (!/^[A-Za-z0-9-]{3,30}$/.test(b))
        return refuse("invalid", "settlement batch: 3–30 letters, digits or -");
      e.status = "paid";
      e.settledBatchId = b;
      touch(e, viewer);
      log(
        e.orgId,
        displayNameOf(viewer),
        "paid",
        `${e.learnerDisplayName} (${e.leadRefCode})`,
        `${vnd(e.lockedAmountVnd ?? 0)} · batch ${b}`,
      );
      return ok();
    }),

  proposeRule: (viewer, partnerId, draft: TierRuleDraft) =>
    withFault("partners.proposeRule", () => {
      const org = writer(viewer);
      if (refused(org)) return latency(org);
      const p = partners.get(partnerId);
      if (!p || p.orgId !== org) return refuse("not_found");
      const bad = tierRuleIssue(draft);
      if (bad) return refuse("invalid", bad);
      if ([...rules.values()].some((r) => r.partnerId === partnerId && r.status === "pending"))
        return refuse("invalid_step", "a version is already waiting for an Org Admin");
      const version =
        Math.max(
          0,
          ...[...rules.values()].filter((r) => r.partnerId === partnerId).map((r) => r.version),
        ) + 1;
      addRule({
        partnerId,
        version,
        status: "pending",
        cycle: draft.cycle,
        mode: draft.mode,
        tiers: draft.tiers.map((t) => ({ minCount: t.minCount, amountVnd: t.amountVnd })),
        attributionWindowDays: draft.attributionWindowDays,
        clawbackWindowDays: draft.clawbackWindowDays,
        dataClassification: "confidential",
        proposedBy: displayNameOf(viewer),
        proposedByPrincipal: viewer.principalId,
        proposedAt: new Date().toISOString(),
        decidedBy: null,
        decidedAt: null,
      });
      log(
        org,
        displayNameOf(viewer),
        "rule proposed",
        `${p.name} v${version}`,
        draft.tiers.map((t) => `${t.minCount}+: ${vnd(t.amountVnd)}`).join(", "),
      );
      return ok();
    }),

  decideRule: (viewer, ruleId, decision) =>
    withFault("partners.decideRule", () => {
      const org = writer(viewer);
      if (refused(org)) return latency(org);
      if (!viewer.orgAdmin) return refuse("not_org_admin");
      const r = rules.get(ruleId);
      const p = r ? partners.get(r.partnerId) : undefined;
      if (!r || !p || p.orgId !== org) return refuse("not_found");
      if (r.status !== "pending") return refuse("invalid_step", `already ${r.status}`);
      if (r.proposedByPrincipal === viewer.principalId)
        return refuse("own_step", "you proposed this version — another Org Admin decides");
      const now = new Date().toISOString();
      if (decision === "activate")
        for (const x of rules.values())
          if (x.partnerId === r.partnerId && x.status === "active") x.status = "retired";
      r.status = decision === "activate" ? "active" : "rejected";
      r.decidedBy = displayNameOf(viewer);
      r.decidedAt = now;
      log(
        org,
        displayNameOf(viewer),
        decision === "activate" ? "rule activated" : "rule rejected",
        `${p.name} v${r.version}`,
        decision === "activate"
          ? "applies to enrolments recorded from now on; earlier entries keep their version"
          : null,
      );
      return ok();
    }),

  actOnSignal: (viewer, signalId, action, note) =>
    withFault("partners.signal", () => {
      const org = writer(viewer);
      if (refused(org)) return latency(org);
      const s = signalsOf(org, Date.now()).find((x) => x.id === signalId);
      if (!s) return refuse("not_found");
      const n = (note ?? "").trim();
      if (action === "dismiss" && (n.length < 3 || n.length > 200))
        return refuse("invalid", "say why you dismiss it (3–200 characters)");
      marks.set(signalId, {
        state: action === "follow" ? "followed" : action === "snooze" ? "snoozed" : "dismissed",
        note: n || null,
        until: action === "snooze" ? new Date(Date.now() + SNOOZE_DAYS * DAY).toISOString() : null,
      });
      log(
        org,
        displayNameOf(viewer),
        `signal ${action === "follow" ? "followed" : action === "snooze" ? `snoozed ${SNOOZE_DAYS} days` : "dismissed"}`,
        `${s.rule.replace(/_/g, " ")} · ${s.partnerName}`,
        n || null,
      );
      return ok();
    }),
};
