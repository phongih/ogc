/*
 * Partner Commissions on the Platform API, core (owner 23/11: refer from Admissions, partners
 * ranked by fit, ledger, tier rules with versions, signals, activity; settlements, report import
 * and trends come next). The rules of the demo's mock adapter
 * (apps/web/src/lib/adapters/mockPartners.ts, owner decisions 22/11), on PostgreSQL:
 *  - a lead goes out from Admissions and closes there as "Referred to partner"; only a reference
 *    code, a short display name and the course go to the partner;
 *  - suggestions are ranked by FIT FOR THE LEARNER (course, near the learner's center,
 *    retention); the commission is shown for information only and never used to rank;
 *  - staff (partners:manage) record what partners report; an Org Admin activates a rule version
 *    and approves an entry — never their own step; approving locks the amount;
 *  - signals only suggest; a person follows, snoozes or dismisses (with a reason);
 *  - every step goes into an append-only activity log.
 * SYNTHETIC: a mock receivable — nothing is invoiced, collected or paid.
 */
import { sql } from "kysely";
import { authorize, commissionFor, tierIndexFor, tierRuleIssue } from "@ogc/contracts";
import type {
  ActivityEntry,
  CommissionCycle,
  CommissionEntry,
  CommissionStatus,
  CommissionTier,
  DecisionSignal,
  Partner,
  PartnerFit,
  PartnerSummary,
  PartnersOverview,
  PartnersRefusal,
  SignalState,
  TierRule,
  TierRuleDraft,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { canReferOut, referLeadOut } from "./admissions.js";

const DAY = 86_400_000;
const TZ = 7 * 3_600_000; // center time (Asia/Ho_Chi_Minh)
export const STALE_DAYS = 10;
export const REJECTION_ALERT_PCT = 25;
export const REJECTION_MIN_DECIDED = 4;
export const SNOOZE_DAYS = 7;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The commission cycle (center time) a moment falls in. */
export function cycleOf(cycle: CommissionCycle, t: number) {
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
const iso = (d: Date | null) => (d ? d.toISOString() : null);

type Result = { ok: true } | { ok: false; reason: PartnersRefusal; detail?: string };
const no = (reason: PartnersRefusal, detail?: string): Result => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});

interface P {
  id: string;
  name: string;
  courses: string[];
  nearCenterIds: string[];
  retentionPct: number;
  settlementDays: number;
}
interface R extends Omit<TierRule, "mine"> {
  proposedByPrincipal: string;
}
interface E {
  id: string;
  partnerId: string;
  leadId: string | null;
  leadRefCode: string;
  learnerDisplayName: string;
  courseCode: string;
  referredAt: string;
  expiresAt: string;
  enrolledAt: string | null;
  enrolledBy: string | null;
  status: CommissionStatus;
  appliedRuleId: string | null;
  lockedAmountVnd: number | null;
  lockedTierIndex: number | null;
  approvedAt: string | null;
  dueDate: string | null;
  rejectReason: string | null;
  settledBatchId: string | null;
  updatedBy: string;
  updatedAt: string;
}
interface Book {
  partners: P[];
  rules: R[];
  entries: E[];
  marks: Map<
    string,
    { state: Exclude<SignalState, "open">; note: string | null; until: string | null }
  >;
  centers: Map<string, string>;
}

async function loadBook(tx: TenantTx): Promise<Book> {
  const [ps, rs, es, ms, cs] = await Promise.all([
    tx.selectFrom("partner").selectAll().orderBy("id").execute(),
    tx.selectFrom("partner_rule").selectAll().execute(),
    tx.selectFrom("commission_entry").selectAll().execute(),
    tx.selectFrom("partner_signal_mark").selectAll().execute(),
    tx.selectFrom("center").select(["id", "name"]).execute(),
  ]);
  return {
    partners: ps.map((p) => ({
      id: p.id,
      name: p.name,
      courses: p.courses,
      nearCenterIds: p.near_center_ids,
      retentionPct: p.retention_pct,
      settlementDays: p.settlement_days,
    })),
    rules: rs
      .map((r) => ({
        id: r.id,
        partnerId: r.partner_id,
        version: r.version,
        status: r.status,
        cycle: r.cycle,
        mode: r.mode,
        tiers: r.tiers as CommissionTier[],
        attributionWindowDays: r.attribution_window_days,
        clawbackWindowDays: r.clawback_window_days,
        dataClassification: "confidential" as const,
        proposedBy: r.proposed_by_name,
        proposedByPrincipal: r.proposed_by,
        proposedAt: iso(r.proposed_at)!,
        decidedBy: r.decided_by_name,
        decidedAt: iso(r.decided_at),
      }))
      .sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3))),
    entries: es
      .map((e) => ({
        id: e.id,
        partnerId: e.partner_id,
        leadId: e.lead_id,
        leadRefCode: e.lead_ref_code,
        learnerDisplayName: e.learner_display_name,
        courseCode: e.course_code,
        referredAt: iso(e.referred_at)!,
        expiresAt: iso(e.expires_at)!,
        enrolledAt: iso(e.enrolled_at),
        enrolledBy: e.enrolled_by,
        status: e.status,
        appliedRuleId: e.applied_rule_id,
        lockedAmountVnd: e.locked_amount_vnd === null ? null : Number(e.locked_amount_vnd),
        lockedTierIndex: e.locked_tier_index,
        approvedAt: iso(e.approved_at),
        dueDate: iso(e.due_date),
        rejectReason: e.reject_reason,
        settledBatchId: e.settled_batch_id,
        updatedBy: e.updated_by_name,
        updatedAt: iso(e.updated_at)!,
      }))
      .sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3))),
    marks: new Map(
      ms.map((m) => [m.signal_id, { state: m.state, note: m.note, until: iso(m.until) }]),
    ),
    centers: new Map(cs.map((c) => [c.id, c.name])),
  };
}

// ── derived (the demo's) ──────────────────────────────────────────────────────────────────────
const activeRule = (b: Book, pid: string) =>
  b.rules.find((r) => r.partnerId === pid && r.status === "active") ?? null;
const counted = (s: CommissionStatus) => s === "enrolled" || s === "approved" || s === "paid";

/** Position, cycle count and amount of an enrolled entry under the rule it was enrolled with. */
export function computed(b: Book, e: E, now: number) {
  const rule = e.appliedRuleId ? (b.rules.find((r) => r.id === e.appliedRuleId) ?? null) : null;
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
  const same = b.entries
    .filter(
      (x) =>
        x.partnerId === e.partnerId &&
        counted(x.status) &&
        x.enrolledAt &&
        cycleOf(rule.cycle, Date.parse(x.enrolledAt)).key === cycle.key,
    )
    .sort(
      (a, c) =>
        Date.parse(a.enrolledAt!) - Date.parse(c.enrolledAt!) ||
        Number(a.id.slice(3)) - Number(c.id.slice(3)),
    );
  const position = same.findIndex((x) => x.id === e.id) + 1;
  const c = commissionFor(rule, Math.max(position, 1), same.length);
  return {
    rule,
    cycle,
    tierIndex: c.tierIndex,
    amountVnd: c.amountVnd,
    provisional: rule.mode === "retroactive" && now < cycle.end,
    approvableFrom: Math.max(
      t + rule.clawbackWindowDays * DAY,
      rule.mode === "retroactive" ? cycle.end : 0,
    ),
  };
}

function view(b: Book, e: E, now: number): CommissionEntry {
  const c = computed(b, e, now);
  const locked = e.status === "approved" || e.status === "paid";
  return {
    id: e.id,
    partnerId: e.partnerId,
    partnerName: b.partners.find((p) => p.id === e.partnerId)?.name ?? "Partner",
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
    batchId: e.settledBatchId,
    updatedBy: e.updatedBy,
    updatedAt: e.updatedAt,
    enrolledBy: e.enrolledBy,
  };
}

function summaryOf(b: Book, p: P, now: number): PartnerSummary {
  const list = b.entries.filter((e) => e.partnerId === p.id).map((e) => view(b, e, now));
  const by = (s: CommissionStatus) => list.filter((e) => e.status === s);
  const rule = activeRule(b, p.id);
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

function signalsOf(b: Book, now: number): DecisionSignal[] {
  const out: Omit<DecisionSignal, "state" | "note">[] = [];
  for (const p of b.partners) {
    const rule = activeRule(b, p.id);
    const list = b.entries.filter((e) => e.partnerId === p.id);
    const s = summaryOf(b, p, now);
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
    const stale = referred.filter((e) => now - Date.parse(e.referredAt) > STALE_DAYS * DAY);
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
    const overdue = list.filter(
      (e) => e.status === "approved" && !!e.dueDate && Date.parse(e.dueDate) < now,
    );
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
            `${e.learnerDisplayName} · ${vnd(e.lockedAmountVnd ?? 0)} · due ${fmtDate(Date.parse(e.dueDate!))} · not in a batch yet`,
        ),
      });
    }
  }
  const order = { open: 0, snoozed: 1, followed: 2, dismissed: 3 } as const;
  return out
    .map((x) => {
      const m = b.marks.get(x.id);
      const state: SignalState =
        !m || (m.state === "snoozed" && m.until && Date.parse(m.until) <= now) ? "open" : m.state;
      return { ...x, state, note: state === "open" ? null : (m?.note ?? null) };
    })
    .sort((a, c) => order[a.state] - order[c.state]);
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────
const STATUS: Record<PartnersRefusal, number> = {
  not_staff: 403,
  not_org_admin: 403,
  own_step: 403,
  access_policy: 403,
  not_found: 404,
  invalid: 422,
  invalid_step: 409,
};

export function registerPartners(app: Api): void {
  const isStaff = (c: Caller) => c.ctx.role === "staff";
  const may = (c: Caller) => authorize(c.ctx, "partners:manage", { orgId: c.ctx.orgId }).allow;
  const nameOf = async (tx: TenantTx, c: Caller) =>
    (
      await tx
        .selectFrom("staff_member")
        .select("display_name")
        .where("principal_id", "=", c.ctx.principalId)
        .executeTakeFirst()
    )?.display_name ?? c.ctx.principalId;

  const read = <T>(
    url: string,
    fn: (b: Book, caller: Caller, params: Record<string, string>, tx: TenantTx) => T | Promise<T>,
  ) =>
    app.secured("GET", url, async (caller, req, reply) => {
      if (!isStaff(caller)) return reply.code(403).send({ error: "not_staff" });
      if (!may(caller)) return reply.code(403).send({ error: "access_policy" });
      return caller.tenant(async (tx) =>
        fn(await loadBook(tx), caller, req.params as Record<string, string>, tx),
      );
    });

  /** A staff write with partners:manage: serialised (partners, then admissions), audited, logged. */
  const write = (
    url: string,
    run: (
      tx: TenantTx,
      b: Book,
      caller: Caller,
      body: Record<string, unknown>,
      params: Record<string, string>,
      now: Date,
      log: (action: string, subject: string, detail?: string | null) => Promise<void>,
    ) => Promise<Result>,
  ) =>
    app.secured("POST", url, async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = req.params as Record<string, string>;
      await caller.write<Result>(`POST ${url}`, { params, body }, async (tx) => {
        let r: Result;
        if (!isStaff(caller)) r = no("not_staff");
        else if (!may(caller)) r = no("access_policy");
        else {
          await sql`select pg_advisory_xact_lock(hashtext('partners:' || ${caller.ctx.orgId}))`.execute(
            tx,
          );
          await sql`select pg_advisory_xact_lock(hashtext('admissions:' || ${caller.ctx.orgId}))`.execute(
            tx,
          );
          const now = new Date(caller.now());
          const by = await nameOf(tx, caller);
          const log = async (action: string, subject: string, detail: string | null = null) => {
            await sql`insert into partner_activity (org_id, seq, at, by_name, action, subject, detail)
                      select ${caller.ctx.orgId}, coalesce(max(seq), 0) + 1, ${now}, ${by}, ${action}, ${subject}, ${detail}
                        from partner_activity`.execute(tx);
          };
          r = await run(tx, await loadBook(tx), caller, body, params, now, log);
        }
        return {
          status: r.ok ? 200 : STATUS[r.reason],
          body: r,
          audit: {
            action: "partners:manage",
            resource: { ...params },
            outcome: r.ok ? ("allowed" as const) : ("denied" as const),
            ...(r.ok ? { after: body } : { reason: r.reason }),
          },
        };
      });
    });

  const entryOf = (b: Book, id: string) => b.entries.find((e) => e.id === id) ?? null;

  read("/v1/partners/overview", (b, caller): PartnersOverview => {
    const now = caller.now();
    const sums = b.partners.map((p) => summaryOf(b, p, now));
    return {
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
      signals: signalsOf(b, now),
      canManage: true,
      isOrgAdmin: caller.ctx.orgAdmin === true,
    };
  });

  read("/v1/partners", (b, caller): Partner[] =>
    b.partners.map((p) => {
      const versions = b.rules
        .filter((r) => r.partnerId === p.id)
        .sort((a, c) => c.version - a.version);
      const rv = (r: R): TierRule => {
        const { proposedByPrincipal, ...rest } = r;
        return {
          ...rest,
          tiers: r.tiers.map((t) => ({ ...t })),
          mine: proposedByPrincipal === caller.ctx.principalId,
        };
      };
      const act = versions.find((r) => r.status === "active");
      const pend = versions.find((r) => r.status === "pending");
      return {
        id: p.id,
        name: p.name,
        courses: [...p.courses],
        nearCenters: p.nearCenterIds.map((id) => b.centers.get(id) ?? id),
        retentionPct: p.retentionPct,
        settlementDays: p.settlementDays,
        rule: act ? rv(act) : null,
        pendingRule: pend ? rv(pend) : null,
        history: versions.map(rv),
      };
    }),
  );

  read("/v1/partners/entries", (b, caller): CommissionEntry[] =>
    [...b.entries]
      .sort(
        (a, c) =>
          Date.parse(c.referredAt) - Date.parse(a.referredAt) ||
          Number(c.id.slice(3)) - Number(a.id.slice(3)),
      )
      .map((e) => view(b, e, caller.now())),
  );

  read("/v1/partners/activity", async (_b, _caller, _p, tx): Promise<ActivityEntry[]> =>
    (await tx.selectFrom("partner_activity").selectAll().orderBy("seq", "desc").execute()).map(
      (a) => ({
        at: a.at.toISOString(),
        by: a.by_name,
        action: a.action,
        subject: a.subject,
        detail: a.detail,
      }),
    ),
  );

  read(
    "/v1/partners/suggest/:leadId",
    async (b, _caller, params, tx): Promise<PartnerFit[] | null> => {
      const l = await tx
        .selectFrom("lead")
        .select(["course_code", "center_id"])
        .where("id", "=", params.leadId)
        .executeTakeFirst();
      if (!l) return [];
      return (
        b.partners
          .map((p): PartnerFit => {
            const teaches = p.courses.includes(l.course_code);
            const near = p.nearCenterIds.includes(l.center_id);
            const rule = activeRule(b, p.id);
            return {
              partnerId: p.id,
              partnerName: p.name,
              fits: teaches,
              reasons: [
                teaches ? `teaches ${l.course_code}` : `does not teach ${l.course_code}`,
                near ? "near the learner's center" : "not near the learner's center",
                `${p.retentionPct}% of referred learners still learning after 3 months`,
              ],
              score: (teaches ? 50 : 0) + (near ? 30 : 0) + Math.round(p.retentionPct * 0.2),
              commissionInfo: rule
                ? `${vnd(rule.tiers[0].amountVnd)}–${vnd(rule.tiers[rule.tiers.length - 1].amountVnd)} per learner (${rule.mode}, ${rule.cycle})`
                : null,
            };
          })
          // Fit for the learner only — the commission is never part of the order.
          .sort(
            (a, c) =>
              Number(c.fits) - Number(a.fits) ||
              c.score - a.score ||
              a.partnerName.localeCompare(c.partnerName),
          )
      );
    },
  );

  write("/v1/partners/refer", async (tx, b, caller, d, _p, now, log) => {
    const leadId = typeof d.leadId === "string" ? d.leadId : "";
    const lead = await tx
      .selectFrom("lead")
      .select(["id", "learner_name", "course_code", "center_id"])
      .where("id", "=", leadId)
      .executeTakeFirst();
    const p = b.partners.find((x) => x.id === d.partnerId);
    if (!lead || !p) return no("not_found");
    if (
      !authorize(caller.ctx, "admissions:manage", {
        orgId: caller.ctx.orgId,
        centerId: lead.center_id,
      }).allow
    )
      return no("access_policy");
    const why = await canReferOut(tx, leadId);
    if (why) return no("invalid_step", why);
    if (b.entries.some((e) => e.leadId === leadId))
      return no("invalid_step", "this lead was already referred to a partner");
    if (!p.courses.includes(lead.course_code))
      return no("invalid", `${p.name} does not teach ${lead.course_code}`);
    const rule = activeRule(b, p.id);
    if (!rule) return no("invalid_step", `${p.name} has no active tier rule`);
    const n = Math.max(0, ...b.entries.map((e) => Number(e.id.slice(3)))) + 1;
    const ref = Math.max(1000, ...b.entries.map((e) => Number(e.leadRefCode.slice(3)))) + 1;
    const by = await nameOf(tx, caller);
    const expires = new Date(now.getTime() + rule.attributionWindowDays * DAY);
    await tx
      .insertInto("commission_entry")
      .values({
        org_id: caller.ctx.orgId,
        id: `CE-${n}`,
        partner_id: p.id,
        lead_id: leadId,
        lead_ref_code: `LR-${ref}`,
        learner_display_name: lead.learner_name,
        course_code: lead.course_code,
        referred_at: now,
        expires_at: expires,
        enrolled_at: null,
        enrolled_by: null,
        status: "referred",
        applied_rule_id: null,
        locked_amount_vnd: null,
        locked_tier_index: null,
        approved_at: null,
        due_date: null,
        reject_reason: null,
        settled_batch_id: null,
        updated_by_name: by,
        updated_at: now,
      })
      .execute();
    await referLeadOut(tx, caller.ctx.orgId, leadId, p.name, now, by);
    await log(
      "referred",
      `${lead.learner_name} (LR-${ref}) → ${p.name}`,
      `${lead.course_code}; window ends ${fmtDate(expires.getTime())}`,
    );
    return { ok: true };
  });

  write("/v1/partners/entries/:id/enrolled", async (tx, b, caller, _d, p, now, log) => {
    const e = entryOf(b, p.id);
    if (!e) return no("not_found");
    if (e.status !== "referred") return no("invalid_step", `already ${e.status}`);
    if (now.getTime() > Date.parse(e.expiresAt))
      return no(
        "invalid_step",
        `the attribution window ended on ${fmtDate(Date.parse(e.expiresAt))} — reject it instead`,
      );
    const rule = activeRule(b, e.partnerId);
    if (!rule) return no("invalid_step", "the partner has no active tier rule");
    const by = await nameOf(tx, caller);
    await tx
      .updateTable("commission_entry")
      .set({
        status: "enrolled",
        enrolled_at: now,
        enrolled_by: caller.ctx.principalId,
        applied_rule_id: rule.id, // snapshot: the rule in force when the enrolment is recorded
        updated_by_name: by,
        updated_at: now,
      })
      .where("id", "=", e.id)
      .execute();
    const after = {
      ...e,
      status: "enrolled" as const,
      enrolledAt: now.toISOString(),
      appliedRuleId: rule.id,
    };
    const c = computed(
      { ...b, entries: b.entries.map((x) => (x.id === e.id ? after : x)) },
      after,
      now.getTime(),
    );
    await log(
      "enrolment recorded",
      `${e.learnerDisplayName} (${e.leadRefCode})`,
      `rule v${rule.version} · tier ${c.tierIndex} · ${vnd(c.amountVnd ?? 0)}${c.provisional ? " (provisional)" : ""}`,
    );
    return { ok: true };
  });

  write("/v1/partners/entries/:id/reject", async (tx, b, caller, d, p, now, log) => {
    const e = entryOf(b, p.id);
    if (!e) return no("not_found");
    if (e.status !== "referred" && e.status !== "enrolled")
      return no("invalid_step", `cannot reject an entry that is ${e.status}`);
    const reason = typeof d.reason === "string" ? d.reason.trim() : "";
    if (reason.length < 3 || reason.length > 200)
      return no("invalid", "give a reason (3–200 characters)");
    if (/\d{6,}|@/.test(reason)) return no("invalid", "no phone numbers or e-mail addresses");
    await tx
      .updateTable("commission_entry")
      .set({
        status: "rejected",
        reject_reason: reason,
        updated_by_name: await nameOf(tx, caller),
        updated_at: now,
      })
      .where("id", "=", e.id)
      .execute();
    await log("rejected", `${e.learnerDisplayName} (${e.leadRefCode})`, reason);
    return { ok: true };
  });

  write("/v1/partners/entries/:id/approve", async (tx, b, caller, _d, p, now, log) => {
    if (!caller.ctx.orgAdmin) return no("not_org_admin");
    const e = entryOf(b, p.id);
    if (!e) return no("not_found");
    if (e.status !== "enrolled")
      return no("invalid_step", `cannot approve an entry that is ${e.status}`);
    if (e.enrolledBy === caller.ctx.principalId)
      return no("own_step", "you recorded this enrolment — another person approves it");
    const c = computed(b, e, now.getTime());
    if (c.approvableFrom && now.getTime() < c.approvableFrom)
      return no(
        "invalid_step",
        `not before ${fmtDate(c.approvableFrom)} (${c.rule?.mode === "retroactive" ? "cycle end / clawback" : "clawback window"})`,
      );
    const partner = b.partners.find((x) => x.id === e.partnerId)!;
    const due = new Date(now.getTime() + partner.settlementDays * DAY);
    await tx
      .updateTable("commission_entry")
      .set({
        status: "approved",
        locked_amount_vnd: c.amountVnd,
        locked_tier_index: c.tierIndex,
        approved_at: now,
        due_date: due,
        updated_by_name: await nameOf(tx, caller),
        updated_at: now,
      })
      .where("id", "=", e.id)
      .execute();
    await log(
      "approved",
      `${e.learnerDisplayName} (${e.leadRefCode})`,
      `${vnd(c.amountVnd ?? 0)} · tier ${c.tierIndex} · due ${fmtDate(due.getTime())}`,
    );
    return { ok: true };
  });

  write("/v1/partners/:partnerId/rules", async (tx, b, caller, d, p, now, log) => {
    const partner = b.partners.find((x) => x.id === p.partnerId);
    if (!partner) return no("not_found");
    const draft = d as unknown as TierRuleDraft;
    let bad: string | null;
    try {
      bad = tierRuleIssue(draft);
    } catch {
      bad = "malformed rule";
    }
    if (bad) return no("invalid", bad);
    if (b.rules.some((r) => r.partnerId === partner.id && r.status === "pending"))
      return no("invalid_step", "a version is already waiting for an Org Admin");
    const version =
      Math.max(0, ...b.rules.filter((r) => r.partnerId === partner.id).map((r) => r.version)) + 1;
    const id = `TR-${Math.max(0, ...b.rules.map((r) => Number(r.id.slice(3)))) + 1}`;
    await tx
      .insertInto("partner_rule")
      .values({
        org_id: caller.ctx.orgId,
        id,
        partner_id: partner.id,
        version,
        status: "pending",
        cycle: draft.cycle,
        mode: draft.mode,
        tiers: JSON.stringify(
          draft.tiers.map((t) => ({ minCount: t.minCount, amountVnd: t.amountVnd })),
        ),
        attribution_window_days: draft.attributionWindowDays,
        clawback_window_days: draft.clawbackWindowDays,
        proposed_by: caller.ctx.principalId,
        proposed_by_name: await nameOf(tx, caller),
        proposed_at: now,
        decided_by_name: null,
        decided_at: null,
      })
      .execute();
    await log(
      "rule proposed",
      `${partner.name} v${version}`,
      draft.tiers.map((t) => `${t.minCount}+: ${vnd(t.amountVnd)}`).join(", "),
    );
    return { ok: true };
  });

  write("/v1/partners/rules/:ruleId/:decision", async (tx, b, caller, _d, p, now, log) => {
    if (p.decision !== "activate" && p.decision !== "reject") return no("not_found");
    if (!caller.ctx.orgAdmin) return no("not_org_admin");
    const r = b.rules.find((x) => x.id === p.ruleId);
    const partner = r ? b.partners.find((x) => x.id === r.partnerId) : undefined;
    if (!r || !partner) return no("not_found");
    if (r.status !== "pending") return no("invalid_step", `already ${r.status}`);
    if (r.proposedByPrincipal === caller.ctx.principalId)
      return no("own_step", "you proposed this version — another Org Admin decides");
    const by = await nameOf(tx, caller);
    if (p.decision === "activate")
      await tx
        .updateTable("partner_rule")
        .set({ status: "retired" })
        .where("partner_id", "=", r.partnerId)
        .where("status", "=", "active")
        .execute();
    await tx
      .updateTable("partner_rule")
      .set({
        status: p.decision === "activate" ? "active" : "rejected",
        decided_by_name: by,
        decided_at: now,
      })
      .where("id", "=", r.id)
      .execute();
    await log(
      p.decision === "activate" ? "rule activated" : "rule rejected",
      `${partner.name} v${r.version}`,
      p.decision === "activate"
        ? "applies to enrolments recorded from now on; earlier entries keep their version"
        : null,
    );
    return { ok: true };
  });

  write("/v1/partners/signals/act", async (tx, b, caller, d, _p, now, log) => {
    const s = signalsOf(b, now.getTime()).find((x) => x.id === d.signalId);
    if (!s) return no("not_found");
    const action = d.action;
    if (action !== "follow" && action !== "snooze" && action !== "dismiss")
      return no("invalid", "unknown action");
    const note = typeof d.note === "string" ? d.note.trim() : "";
    if (action === "dismiss" && (note.length < 3 || note.length > 200))
      return no("invalid", "say why you dismiss it (3–200 characters)");
    if (note.length > 200) return no("invalid", "note: at most 200 characters");
    const v = {
      state:
        action === "follow"
          ? ("followed" as const)
          : action === "snooze"
            ? ("snoozed" as const)
            : ("dismissed" as const),
      note: note || null,
      until: action === "snooze" ? new Date(now.getTime() + SNOOZE_DAYS * DAY) : null,
      by_name: await nameOf(tx, caller),
      at: now,
    };
    await tx
      .insertInto("partner_signal_mark")
      .values({ org_id: caller.ctx.orgId, signal_id: s.id, ...v })
      .onConflict((oc) => oc.columns(["org_id", "signal_id"]).doUpdateSet(v))
      .execute();
    await log(
      `signal ${action === "follow" ? "followed" : action === "snooze" ? `snoozed ${SNOOZE_DAYS} days` : "dismissed"}`,
      `${s.rule.replace(/_/g, " ")} · ${s.partnerName}`,
      note || null,
    );
    return { ok: true };
  });
}
