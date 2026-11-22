/*
 * Growth Engine · referrals — MOCK adapter (SYNTHETIC, browser memory; pattern from EduOS SGE).
 * Owner decisions 22/11: guardians and ADULT learners refer; the reward is tuition credit in a
 * wallet (% of the first tuition payment, capped — MOCK, nothing is charged or paid); a referral
 * counts only when the new learner enrolls and pays, and staff confirm it after anti-fraud checks.
 * The public lead form takes a display name and a course only — no contact details.
 */
import type {
  FraudFlag,
  GrowthMetrics,
  GrowthPort,
  GrowthResult,
  IiosGrantedContext,
  MyReferrals,
  ReferralLead,
  ReferralProgram,
  WalletEntry,
} from "@ogc/contracts";
import { members, personaMap } from "../../fixtures/personas";
import { centers } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { classes, rosters } from "../../fixtures/teaching";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { allows } from "./accessPolicy";
import { ogcAccountOf, staffOrgOf } from "./viewer";
import { listPricesOfOrg } from "./mockCenterSetup";
import { withFault } from "./faults";
import {
  allLeads,
  createReferralLead,
  leadById,
  type StoredLead as AdmissionsLead,
} from "./mockAdmissions";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
const refuse = (reason: Exclude<GrowthResult, { ok: true }>["reason"], detail?: string) =>
  latency<GrowthResult>({ ok: false, reason, ...(detail ? { detail } : {}) });
const ok = () => latency<GrowthResult>({ ok: true });

// ── who may refer ─────────────────────────────────────────────────────────────────────────

interface Referrer {
  principalId: string;
  orgId: string;
  name: string;
  code: string;
  household: string[]; // learner ids of the referrer's own household
}

function codeOf(principalId: string): string {
  let h = 7;
  for (const c of principalId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `OGC${h.toString(36).toUpperCase().padStart(6, "0").slice(0, 6)}`;
}

/** Guardians and adult learners of OGC's records. Minors never get a link (owner, 22/11). */
function referrers(): Referrer[] {
  const out: Referrer[] = [];
  for (const m of members) {
    const p = personaMap[m.personaId];
    if (!p) continue;
    if (m.role === "guardian" && p.guardianId)
      out.push({
        principalId: m.principalId,
        orgId: m.orgId,
        name: m.displayName,
        code: codeOf(m.principalId),
        household: [...(p.linkedLearnerIds ?? [])],
      });
    else if (m.role === "learner" && p.learnerId && p.adult)
      out.push({
        principalId: m.principalId,
        orgId: m.orgId,
        name: m.displayName,
        code: codeOf(m.principalId),
        household: [p.learnerId],
      });
  }
  return out;
}
const referrerByCode = (code: string) => referrers().find((r) => r.code === code.toUpperCase());

function referrerOf(viewer: IiosGrantedContext): Referrer | null {
  if (!ogcAccountOf(viewer)) return null; // grant must fit OGC's record (principal + org + role)
  return (
    referrers().find((r) => r.principalId === viewer.principalId && r.orgId === viewer.orgId) ??
    null
  );
}

// ── state ─────────────────────────────────────────────────────────────────────────────────

const DEFAULT_PROGRAM: ReferralProgram = {
  enabled: true,
  rewardPct: 5,
  capVnd: 2_000_000,
  campaigns: [
    { id: "camp-tet-2027", name: "Tết 2027 — bring a friend", active: true, bonusPct: 2 },
  ],
};

interface StoredLead extends ReferralLead {
  orgId: string;
  centerId: string;
  referrerPrincipalId: string;
}

// The reward decision per referral lead. The lead itself lives in Admissions (one pipeline, 22/11).
interface Reward {
  status: "confirmed" | "rejected";
  rewardVnd: number | null;
  at: string;
  reason: string | null;
}

const programs = new Map<string, ReferralProgram>();
const clicks = new Map<string, number>(); // code → count
const rewards = new Map<string, Reward>(); // admissions lead id → reward decision
const wallets = new Map<string, WalletEntry[]>(); // principalId → entries
let seq = 0;

function resetGrowth() {
  programs.clear();
  clicks.clear();
  rewards.clear();
  wallets.clear();
  seq = 0;
}
sessionStore.onReset(resetGrowth);
export const __resetGrowthForTests = resetGrowth;
registerPersistent("growth", {
  dump: () => ({ programs, clicks, rewards, wallets, seq }),
  load: (raw) => {
    const r = raw as Record<string, unknown>;
    refill(programs, r.programs);
    refill(clicks, r.clicks);
    refill(rewards, r.rewards); // saves from before 22/11 kept leads here — they are not carried over
    refill(wallets, r.wallets);
    seq = Number(r.seq) || 0;
  },
});

const programOf = (orgId: string): ReferralProgram => {
  let p = programs.get(orgId);
  if (!p) {
    p = structuredClone(DEFAULT_PROGRAM);
    programs.set(orgId, p);
  }
  return p;
};

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const nameOfLearner = (learnerId: string) => {
  for (const list of Object.values(rosters)) {
    const r = list.find((x) => x.learnerId === learnerId);
    if (r) return r.displayName;
  }
  return null;
};

/** A referral lead as Growth sees it: the Admissions lead + the reward decision. */
function toStored(a: AdmissionsLead): StoredLead {
  const r = rewards.get(a.id);
  const ref = a.referral!;
  const at = (stage: AdmissionsLead["stage"]) =>
    a.history.find((h) => h.stage === stage)?.at ?? null;
  const status: ReferralLead["status"] = r
    ? r.status
    : a.stage === "lost"
      ? "rejected"
      : a.stage === "enrolled"
        ? "enrolled"
        : a.stage === "placement" || a.stage === "offer"
          ? "placed"
          : "lead";
  return {
    id: a.id,
    orgId: a.orgId,
    centerId: a.centerId,
    referrerPrincipalId: ref.principalId,
    code: ref.code,
    referrerName: ref.name,
    learnerName: a.learnerName,
    courseCode: a.courseCode,
    centerName: centers.find((c) => c.id === a.centerId)?.name ?? "",
    campaignId: ref.campaignId,
    status,
    stage: a.stage,
    createdAt: a.createdAt,
    placedAt: at("placement"),
    enrolledAt: at("enrolled"),
    invoiceNo: a.invoiceNo,
    firstPaymentVnd: a.firstPaymentVnd,
    rewardVnd: r?.status === "confirmed" ? r.rewardVnd : null,
    confirmedAt: r?.status === "confirmed" ? r.at : null,
    rejectedReason:
      r?.status === "rejected"
        ? r.reason
        : a.stage === "lost"
          ? `Lost: ${a.lostReason ?? ""}`
          : null,
    flags: [],
  };
}
const referralLeads = (): StoredLead[] =>
  allLeads()
    .filter((a) => a.source === "referral" && a.referral)
    .map(toStored);
const leadOf = (id: string): StoredLead | null => {
  const a = leadById(id);
  return a && a.source === "referral" && a.referral ? toStored(a) : null;
};

/** Anti-fraud checks, recomputed every time a lead is shown or confirmed. */
function flagsOf(l: StoredLead): FraudFlag[] {
  const ref = referrers().find((r) => r.principalId === l.referrerPrincipalId);
  const f: FraudFlag[] = [];
  const name = norm(l.learnerName);
  const p = members.find((m) => m.principalId === l.referrerPrincipalId);
  const own = p ? personaMap[p.personaId]?.learnerId : undefined;
  if (own && norm(nameOfLearner(own) ?? "") === name) f.push("self_referral");
  else if (ref?.household.some((id) => norm(nameOfLearner(id) ?? "") === name))
    f.push("same_household");
  const atCenter = classes
    .filter((c) => c.centerId === l.centerId)
    .flatMap((c) => rosters[c.id] ?? []);
  // Any other open lead of the pipeline (any source) for the same name at the same center.
  const otherLead = allLeads().some(
    (o) =>
      o.id !== l.id &&
      o.orgId === l.orgId &&
      norm(o.learnerName) === name &&
      o.centerId === l.centerId &&
      o.stage !== "lost" &&
      rewards.get(o.id)?.status !== "rejected",
  );
  if (atCenter.some((r) => norm(r.displayName) === name) || otherLead) f.push("duplicate");
  if (
    referralLeads().some(
      (o) =>
        o.id !== l.id &&
        o.status === "confirmed" &&
        norm(o.learnerName) === name &&
        o.orgId === l.orgId,
    )
  )
    f.push("already_rewarded");
  return f;
}

const view = (l: StoredLead): ReferralLead => {
  const { orgId: _o, referrerPrincipalId: _r, centerId: _c, ...rest } = l;
  void _o;
  void _r;
  void _c;
  return { ...rest, flags: flagsOf(l) };
};

const balanceOf = (principalId: string) =>
  (wallets.get(principalId) ?? []).reduce((t, e) => t + e.amountVnd, 0);

// ── Billing hooks (adapter-internal, not part of GrowthPort) ────────────────────────────────
// Billing (22/11) owns invoices; Growth owns leads and wallets. Billing calls these.

export const walletBalanceOf = balanceOf;

/** Apply up to maxVnd of a referrer's wallet credit to an invoice; returns what was applied. */
export function consumeCredit(principalId: string, maxVnd: number, note: string): number {
  const amount = Math.min(balanceOf(principalId), Math.max(0, maxVnd));
  if (amount <= 0) return 0;
  const list = wallets.get(principalId) ?? [];
  list.push({
    id: `W-${++seq}`,
    at: new Date().toISOString(),
    kind: "applied",
    amountVnd: -amount,
    note,
  });
  wallets.set(principalId, list);
  return amount;
}

/** Give credit back (the invoice it was applied to was voided). */
export function refundCredit(principalId: string, amountVnd: number, note: string): void {
  if (amountVnd <= 0) return;
  const list = wallets.get(principalId) ?? [];
  list.push({ id: `W-${++seq}`, at: new Date().toISOString(), kind: "credit", amountVnd, note });
  wallets.set(principalId, list);
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const monthOf = (iso: string) =>
  new Date(Date.parse(iso) + 7 * 3600 * 1000).toISOString().slice(0, 7); // center time

function staffWrite(viewer: IiosGrantedContext, leadId: string): StoredLead | GrowthResult {
  const org = staffOrgOf(viewer);
  if (!org) return { ok: false, reason: "not_staff" };
  if (!allows(viewer, "growth:manage")) return { ok: false, reason: "access_policy" };
  const l = leadOf(leadId);
  if (!l || l.orgId !== org) return { ok: false, reason: "not_found" };
  return l;
}
const isResult = (x: StoredLead | GrowthResult): x is GrowthResult => "ok" in x;

// ── port ──────────────────────────────────────────────────────────────────────────────────

export const mockGrowth: GrowthPort = {
  getMine: (viewer) =>
    withFault("growth.getMine", () => {
      const me = referrerOf(viewer);
      if (!me) return latency<MyReferrals | null>(null);
      const program = structuredClone(programOf(me.orgId));
      const mine = referralLeads().filter((l) => l.referrerPrincipalId === me.principalId);
      const conversions = mine.filter((l) => l.status === "confirmed").length;
      const c = clicks.get(me.code) ?? 0;
      const board = referrers()
        .filter((r) => r.orgId === me.orgId)
        .map((r) => ({
          r,
          n: referralLeads().filter(
            (l) => l.referrerPrincipalId === r.principalId && l.status === "confirmed",
          ).length,
        }))
        .sort((a, b) => b.n - a.n || a.r.code.localeCompare(b.r.code));
      return latency<MyReferrals>({
        code: me.code,
        link: `/join?ref=${me.code}`,
        shareText: `Join me at OGC English — use my code ${me.code} when you enrol.`,
        program,
        performance: {
          clicks: c,
          leads: mine.length,
          conversions,
          convRatePct: pct(conversions, mine.length),
        },
        myLeads: mine
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map((l) => ({ learnerName: l.learnerName, status: l.status, createdAt: l.createdAt })),
        wallet: {
          balanceVnd: balanceOf(me.principalId),
          entries: [...(wallets.get(me.principalId) ?? [])].reverse(),
        },
        leaderboard: board.map((x, i) => ({
          rank: i + 1,
          label: x.r.principalId === me.principalId ? "You" : `Ambassador #${i + 1}`,
          conversions: x.n,
          you: x.r.principalId === me.principalId,
        })),
      });
    }),

  recordClick: (code) =>
    withFault("growth.recordClick", (): Promise<Awaited<ReturnType<GrowthPort["recordClick"]>>> => {
      const r = referrerByCode(code);
      if (!r || !programOf(r.orgId).enabled)
        return latency({ valid: false, centerNames: [], courses: [] });
      clicks.set(r.code, (clicks.get(r.code) ?? 0) + 1);
      return latency({
        valid: true,
        centerNames: centers.filter((c) => c.orgId === r.orgId).map((c) => c.name),
        courses: courses
          .filter((c) => c.orgId === r.orgId)
          .map((c) => ({ code: c.code, title: c.title })),
      });
    }),

  submitLead: (code, input) =>
    withFault("growth.submitLead", () => {
      const r = referrerByCode(code);
      if (!r || !programOf(r.orgId).enabled) return refuse("not_found");
      const name = input.learnerName.trim();
      if (name.length < 2 || name.length > 60)
        return refuse("invalid", "name must be 2–60 characters");
      if (!courses.some((c) => c.orgId === r.orgId && c.code === input.courseCode))
        return refuse("invalid", "unknown course");
      if (!centers.some((c) => c.orgId === r.orgId && c.name === input.centerName))
        return refuse("invalid", "unknown center");
      const camp = input.campaignId
        ? programOf(r.orgId).campaigns.find((c) => c.id === input.campaignId && c.active)
        : undefined;
      const center = centers.find((c) => c.orgId === r.orgId && c.name === input.centerName)!;
      createReferralLead({
        orgId: r.orgId,
        learnerName: name,
        courseCode: input.courseCode,
        centerId: center.id,
        referral: {
          code: r.code,
          principalId: r.principalId,
          name: r.name,
          campaignId: camp?.id ?? null,
        },
      });
      return ok();
    }),

  listLeads: (viewer) =>
    withFault("growth.listLeads", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<ReferralLead[] | null>(null);
      return latency(
        referralLeads()
          .filter((l) => l.orgId === org)
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map(view),
      );
    }),

  confirm: (viewer, leadId) =>
    withFault("growth.confirm", () => {
      const l = staffWrite(viewer, leadId);
      if (isResult(l)) return latency(l);
      if (l.status !== "enrolled" || !l.firstPaymentVnd)
        return refuse("invalid_step", "confirm only after enrolment and the first payment");
      const flags = flagsOf(l);
      if (flags.length) return refuse("flagged", flags.join(", "));
      const program = programOf(l.orgId);
      const bonus = program.campaigns.find((c) => c.id === l.campaignId && c.active)?.bonusPct ?? 0;
      const reward = Math.min(
        Math.round((l.firstPaymentVnd * (program.rewardPct + bonus)) / 100),
        program.capVnd,
      );
      const at = new Date().toISOString();
      rewards.set(l.id, { status: "confirmed", rewardVnd: reward, at, reason: null });
      const list = wallets.get(l.referrerPrincipalId) ?? [];
      list.push({
        id: `W-${++seq}`,
        at,
        kind: "credit",
        amountVnd: reward,
        note: `Referral: ${l.learnerName} enrolled in ${l.courseCode} (${program.rewardPct + bonus}% of first payment${reward === program.capVnd ? ", capped" : ""}) — applied to your next invoice`,
      });
      wallets.set(l.referrerPrincipalId, list);
      return ok();
    }),

  reject: (viewer, leadId, reason) =>
    withFault("growth.reject", () => {
      const l = staffWrite(viewer, leadId);
      if (isResult(l)) return latency(l);
      if (l.status === "confirmed" || l.status === "rejected")
        return refuse("invalid_step", "already decided");
      if (reason.trim().length < 3) return refuse("invalid", "give a reason");
      rewards.set(l.id, {
        status: "rejected",
        rewardVnd: null,
        at: new Date().toISOString(),
        reason: reason.trim(),
      });
      return ok();
    }),

  getMetrics: (viewer) =>
    withFault("growth.getMetrics", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<GrowthMetrics | null>(null);
      const refs = referrers().filter((r) => r.orgId === org);
      const all = referralLeads().filter((l) => l.orgId === org);
      const confirmed = all.filter((l) => l.status === "confirmed");
      const thisMonth = monthOf(new Date().toISOString());
      const months = [...new Set(all.map((l) => monthOf(l.createdAt)))].sort();
      // LTV proxy (mock): referred learners' first payment vs the organization's list prices.
      const prices = listPricesOfOrg(org);
      const avgPrice = prices.length ? prices.reduce((t, x) => t + x, 0) / prices.length : 0;
      const paid = confirmed.map((l) => l.firstPaymentVnd ?? 0);
      const avgPaid = paid.length ? paid.reduce((t, x) => t + x, 0) / paid.length : 0;
      return latency<GrowthMetrics>({
        referrers: refs.length,
        activeReferrers: refs.filter((r) =>
          all.some((l) => l.referrerPrincipalId === r.principalId),
        ).length,
        clicks: refs.reduce((t, r) => t + (clicks.get(r.code) ?? 0), 0),
        leads: all.length,
        confirmed: confirmed.length,
        confirmedThisMonth: confirmed.filter(
          (l) => l.confirmedAt && monthOf(l.confirmedAt) === thisMonth,
        ).length,
        pendingRewards: all.filter((l) => l.status === "enrolled").length,
        kFactor: refs.length ? Math.round((confirmed.length / refs.length) * 100) / 100 : 0,
        invitesPerReferrer: refs.length ? Math.round((all.length / refs.length) * 100) / 100 : 0,
        conversionPct: pct(confirmed.length, all.length),
        walletIssuedVnd: confirmed.reduce((t, l) => t + (l.rewardVnd ?? 0), 0),
        ltvUpliftPct:
          avgPrice > 0 && paid.length
            ? Math.round(((avgPaid - avgPrice) / avgPrice) * 1000) / 10
            : null,
        cohorts: months.map((m) => {
          const inM = all.filter((l) => monthOf(l.createdAt) === m);
          const c = inM.filter((l) => l.status === "confirmed").length;
          return { month: m, leads: inM.length, confirmed: c, conversionPct: pct(c, inM.length) };
        }),
        campaigns: programOf(org).campaigns.map((c) => ({
          id: c.id,
          name: c.name,
          active: c.active,
          leads: all.filter((l) => l.campaignId === c.id).length,
          confirmed: all.filter((l) => l.campaignId === c.id && l.status === "confirmed").length,
        })),
        topReferrers: refs
          .map((r) => {
            const mine = all.filter((l) => l.referrerPrincipalId === r.principalId);
            const conf = mine.filter((l) => l.status === "confirmed");
            return {
              name: r.name,
              leads: mine.length,
              confirmed: conf.length,
              rewardVnd: conf.reduce((t, l) => t + (l.rewardVnd ?? 0), 0),
            };
          })
          .filter((x) => x.leads > 0)
          .sort((a, b) => b.confirmed - a.confirmed || b.leads - a.leads),
      });
    }),

  getProgram: (viewer) =>
    withFault("growth.getProgram", () => {
      const org = staffOrgOf(viewer);
      return latency(org ? structuredClone(programOf(org)) : null);
    }),

  updateProgram: (viewer, patch) =>
    withFault("growth.updateProgram", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      if (!allows(viewer, "growth:manage")) return refuse("access_policy");
      const next = { ...structuredClone(programOf(org)), ...structuredClone(patch) };
      if (!Number.isFinite(next.rewardPct) || next.rewardPct < 0 || next.rewardPct > 30)
        return refuse("invalid", "reward must be 0–30%");
      if (!Number.isInteger(next.capVnd) || next.capVnd < 0 || next.capVnd > 50_000_000)
        return refuse("invalid", "cap must be 0–50,000,000 VND");
      const known = new Set(programOf(org).campaigns.map((c) => c.id));
      for (const c of next.campaigns) {
        if (!known.has(c.id)) return refuse("invalid", "campaigns are a fixed list in the demo");
        if (c.bonusPct < 0 || c.bonusPct > 20)
          return refuse("invalid", "campaign bonus must be 0–20%");
      }
      programs.set(org, next);
      return ok();
    }),
};
