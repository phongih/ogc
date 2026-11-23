/*
 * Growth · referrals on the Platform API (owner 23/11, slice 6 part A). The rules of the demo's
 * mock adapter (apps/web/src/lib/adapters/mockGrowth.ts, owner decisions 22/11), on PostgreSQL:
 *  - guardians and ADULT learners refer with a link / code; a learner under 18 has none;
 *  - the public /join page (no sign-in) records a click and takes a display name, a course and a
 *    center — no contact details; it is rate-limited per address, per code and per organization
 *    (owner 23/11: public + limits; addresses are never stored);
 *  - a referral lead enters the one Admissions pipeline; Billing moves it to "enrolled" when its
 *    first invoice is paid in full; center staff (growth:manage) then confirm the reward — refused
 *    while an anti-fraud flag stands — or reject it with a reason;
 *  - anti-fraud: self-referral, same household, duplicate (a learner or an open lead with the same
 *    name at that center), already rewarded. Names are compared without case, punctuation or
 *    Vietnamese diacritics (owner 23/11: stricter than the demo);
 *  - the reward is wallet credit: (program % + active campaign %) of the first payment, capped;
 *    Billing applies it to the referrer's invoices issued later (domains/billing.ts).
 * SYNTHETIC: nothing is charged, paid or credited for real.
 */
import { sql } from "kysely";
import { authorize } from "@ogc/contracts";
import type {
  FraudFlag,
  GrowthRefusal,
  LeadStage,
  MyReferrals,
  ReferralLead,
  ReferralProgram,
  WalletEntry,
} from "@ogc/contracts";
import { withTenant, type Db, type TenantTx } from "../db.js";
import { audit } from "../audit.js";
import type { Api, Caller } from "../server.js";
import { createReferralLead } from "./admissions.js";

export const DEFAULT_PROGRAM: ReferralProgram = {
  enabled: true,
  rewardPct: 5,
  capVnd: 2_000_000,
  campaigns: [
    { id: "camp-tet-2027", name: "Tết 2027 — bring a friend", active: true, bonusPct: 2 },
  ],
};

/** Public /join limits (in memory, per API process). */
export const LIMITS = {
  clicksPerAddress: { n: 60, ms: 10 * 60_000 },
  leadsPerAddress: { n: 5, ms: 10 * 60_000 },
  leadsPerCode: { n: 20, ms: 24 * 3_600_000 },
  leadsPerOrg: { n: 200, ms: 24 * 3_600_000 },
};

/** Fixed-window counters; nothing is persisted, addresses are only kept as map keys. */
export function rateLimiter(now: () => number) {
  const hits = new Map<string, { start: number; n: number }>();
  return (key: string, limit: { n: number; ms: number }): boolean => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start >= limit.ms) hits.delete(k);
    const h = hits.get(key);
    if (!h || t - h.start >= limit.ms) {
      hits.set(key, { start: t, n: 1 });
      return true;
    }
    if (h.n >= limit.n) return false;
    h.n++;
    return true;
  };
}

/** Names compared without case, punctuation, spacing or Vietnamese diacritics. */
export const normName = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A referrer's code (stable per principal, as in the demo). */
export function codeOf(principalId: string): string {
  let h = 7;
  for (const c of principalId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `OGC${h.toString(36).toUpperCase().padStart(6, "0").slice(0, 6)}`;
}

interface Referrer {
  principalId: string;
  name: string;
  code: string;
  household: string[]; // learner ids
  self: string | null; // the referrer's own learner id (adult learner)
}

/** Guardians (with a linked learner) and adult learners who sign in. Minors never refer. */
async function referrers(tx: TenantTx): Promise<Referrer[]> {
  const [links, adults] = await Promise.all([
    tx
      .selectFrom("guardian_link")
      .select(["guardian_principal_id", "guardian_name", "learner_id"])
      .orderBy("guardian_principal_id")
      .execute(),
    tx
      .selectFrom("learner")
      .select(["id", "principal_id", "display_name"])
      .where("adult", "=", true)
      .where("principal_id", "is not", null)
      .execute(),
  ]);
  const out = new Map<string, Referrer>();
  for (const l of links) {
    const r = out.get(l.guardian_principal_id) ?? {
      principalId: l.guardian_principal_id,
      name: l.guardian_name ?? l.guardian_principal_id,
      code: codeOf(l.guardian_principal_id),
      household: [],
      self: null,
    };
    r.household.push(l.learner_id);
    out.set(r.principalId, r);
  }
  for (const a of adults)
    out.set(a.principal_id!, {
      principalId: a.principal_id!,
      name: a.display_name,
      code: codeOf(a.principal_id!),
      household: [a.id],
      self: a.id,
    });
  return [...out.values()];
}

export async function programOf(tx: TenantTx): Promise<ReferralProgram> {
  const [p, camps] = await Promise.all([
    tx.selectFrom("referral_program").selectAll().executeTakeFirst(),
    tx.selectFrom("referral_campaign").selectAll().orderBy("id").execute(),
  ]);
  if (!p) return structuredClone(DEFAULT_PROGRAM);
  return {
    enabled: p.enabled,
    rewardPct: Number(p.reward_pct),
    capVnd: Number(p.cap_vnd),
    campaigns: camps.map((c) => ({
      id: c.id,
      name: c.name,
      active: c.active,
      bonusPct: Number(c.bonus_pct),
    })),
  };
}

interface Stored extends ReferralLead {
  centerId: string;
  referrerPrincipalId: string;
}

interface Book {
  leads: Stored[];
  referrers: Referrer[];
  learners: Map<string, string>; // id → display name
  rosterAt: Map<string, Set<string>>; // center → normalized learner names
  all: { id: string; name: string; centerId: string; open: boolean; rejected: boolean }[];
}

async function loadBook(tx: TenantTx): Promise<Book> {
  const [leads, hist, rewards, centers, learners, roster, refs] = await Promise.all([
    tx.selectFrom("lead").selectAll().execute(),
    tx.selectFrom("lead_history").select(["lead_id", "stage", "at"]).orderBy("seq").execute(),
    tx.selectFrom("referral_reward").selectAll().execute(),
    tx.selectFrom("center").select(["id", "name"]).execute(),
    tx.selectFrom("learner").select(["id", "display_name"]).execute(),
    tx
      .selectFrom("roster as r")
      .innerJoin("class as k", "k.id", "r.class_id")
      .innerJoin("learner as l", "l.id", "r.learner_id")
      .select(["k.center_id", "l.display_name"])
      .execute(),
    referrers(tx),
  ]);
  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  const reward = new Map(rewards.map((r) => [r.lead_id, r]));
  const at = (leadId: string, stage: LeadStage) => {
    const h = hist.find((x) => x.lead_id === leadId && x.stage === stage);
    return h ? new Date(h.at).toISOString() : null;
  };
  const rosterAt = new Map<string, Set<string>>();
  for (const r of roster)
    rosterAt.set(
      r.center_id,
      (rosterAt.get(r.center_id) ?? new Set()).add(normName(r.display_name)),
    );
  const out: Stored[] = [];
  for (const l of leads) {
    if (l.source !== "referral" || !l.referrer_principal_id || !l.referral_code) continue;
    const r = reward.get(l.id);
    const status: ReferralLead["status"] = r
      ? r.status
      : l.stage === "lost"
        ? "rejected"
        : l.stage === "enrolled"
          ? "enrolled"
          : l.stage === "placement" || l.stage === "offer"
            ? "placed"
            : "lead";
    out.push({
      id: l.id,
      code: l.referral_code,
      referrerName: l.referrer_name ?? "",
      learnerName: l.learner_name,
      courseCode: l.course_code,
      centerName: centerName.get(l.center_id) ?? "",
      campaignId: l.campaign_id,
      status,
      stage: l.stage,
      createdAt: new Date(l.created_at).toISOString(),
      placedAt: at(l.id, "placement"),
      enrolledAt: at(l.id, "enrolled"),
      invoiceNo: l.invoice_no,
      firstPaymentVnd: l.first_payment_vnd === null ? null : Number(l.first_payment_vnd),
      rewardVnd: r?.status === "confirmed" ? Number(r.reward_vnd) : null,
      confirmedAt: r?.status === "confirmed" ? new Date(r.at).toISOString() : null,
      rejectedReason:
        r?.status === "rejected"
          ? r.reason
          : l.stage === "lost"
            ? `Lost: ${l.lost_reason ?? ""}`
            : null,
      flags: [],
      centerId: l.center_id,
      referrerPrincipalId: l.referrer_principal_id,
    });
  }
  return {
    leads: out,
    referrers: refs,
    learners: new Map(learners.map((l) => [l.id, l.display_name])),
    rosterAt,
    all: leads.map((l) => ({
      id: l.id,
      name: normName(l.learner_name),
      centerId: l.center_id,
      open: l.stage !== "lost",
      rejected: reward.get(l.id)?.status === "rejected",
    })),
  };
}

/** Anti-fraud checks, recomputed every time a lead is shown or confirmed. */
export function flagsOf(b: Book, l: Stored): FraudFlag[] {
  const f: FraudFlag[] = [];
  const name = normName(l.learnerName);
  const ref = b.referrers.find((r) => r.principalId === l.referrerPrincipalId);
  const nameOf = (id: string) => normName(b.learners.get(id) ?? "");
  if (ref?.self && nameOf(ref.self) === name) f.push("self_referral");
  else if (ref?.household.some((id) => nameOf(id) === name)) f.push("same_household");
  const otherLead = b.all.some(
    (o) => o.id !== l.id && o.name === name && o.centerId === l.centerId && o.open && !o.rejected,
  );
  if (b.rosterAt.get(l.centerId)?.has(name) || otherLead) f.push("duplicate");
  if (
    b.leads.some(
      (o) => o.id !== l.id && o.status === "confirmed" && normName(o.learnerName) === name,
    )
  )
    f.push("already_rewarded");
  return f;
}

const view = (b: Book, l: Stored): ReferralLead => {
  const { centerId: _c, referrerPrincipalId: _r, ...rest } = l;
  void _c;
  void _r;
  return { ...rest, flags: flagsOf(b, l) };
};

export async function walletOf(tx: TenantTx, principalId: string) {
  const rows = await tx
    .selectFrom("wallet_entry")
    .selectAll()
    .where("principal_id", "=", principalId)
    .orderBy("at")
    .orderBy("id")
    .execute();
  const entries: WalletEntry[] = rows.map((r) => ({
    id: r.id,
    at: new Date(r.at).toISOString(),
    kind: r.kind,
    amountVnd: Number(r.amount_vnd),
    note: r.note,
  }));
  return { balanceVnd: entries.reduce((t, e) => t + e.amountVnd, 0), entries };
}

/** Add a wallet entry; the caller holds the organization's billing lock. */
export async function addWalletEntry(
  tx: TenantTx,
  orgId: string,
  e: {
    principalId: string;
    at: Date;
    kind: "credit" | "applied";
    amountVnd: number;
    note: string;
    leadId?: string | null;
    invoiceId?: string | null;
  },
): Promise<void> {
  const { rows } = await sql<{ n: number }>`
    select coalesce(max((substring(id from 3))::int), 0)::int as n from wallet_entry`.execute(tx);
  await tx
    .insertInto("wallet_entry")
    .values({
      org_id: orgId,
      id: `W-${rows[0].n + 1}`,
      principal_id: e.principalId,
      at: e.at,
      kind: e.kind,
      amount_vnd: e.amountVnd,
      note: e.note.slice(0, 200),
      lead_id: e.leadId ?? null,
      invoice_id: e.invoiceId ?? null,
    })
    .execute();
}

type Result = { ok: true } | { ok: false; reason: GrowthRefusal; detail?: string };
const no = (reason: GrowthRefusal, detail?: string): Result => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});
const STATUS: Record<GrowthRefusal, number> = {
  not_staff: 403,
  access_policy: 403,
  not_found: 404,
  invalid: 422,
  invalid_step: 409,
  flagged: 409,
};
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerGrowth(app: Api, db: Db, now: () => number): void {
  const isStaff = (c: Caller) => c.ctx.role === "staff";
  const may = (c: Caller) => authorize(c.ctx, "growth:manage", { orgId: c.ctx.orgId }).allow;
  const staffName = async (tx: TenantTx, c: Caller) =>
    (
      await tx
        .selectFrom("staff_member")
        .select("display_name")
        .where("principal_id", "=", c.ctx.principalId)
        .executeTakeFirst()
    )?.display_name ?? c.ctx.principalId;
  /** The caller as a referrer: a guardian, or an adult learner — matched by role and principal. */
  const referrerOf = async (tx: TenantTx, c: Caller) => {
    if (c.ctx.role !== "guardian" && c.ctx.role !== "learner") return null;
    const r = (await referrers(tx)).find((x) => x.principalId === c.ctx.principalId);
    if (!r || (c.ctx.role === "learner") !== (r.self !== null)) return null;
    return r;
  };

  // ── the referrer's page ────────────────────────────────────────────────────────────────────
  app.secured("GET", "/v1/me/referrals", async (caller, _req, reply) => {
    const out = await caller.tenant(async (tx): Promise<MyReferrals | null> => {
      const me = await referrerOf(tx, caller);
      if (!me) return null;
      await tx
        .insertInto("referral_code")
        .values({ code: me.code, org_id: caller.ctx.orgId, principal_id: me.principalId })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const b = await loadBook(tx);
      const program = await programOf(tx);
      const mine = b.leads.filter((l) => l.referrerPrincipalId === me.principalId);
      const conversions = mine.filter((l) => l.status === "confirmed").length;
      const clicks = await tx.selectFrom("referral_click").select(["code", "clicks"]).execute();
      const board = b.referrers
        .map((r) => ({
          r,
          n: b.leads.filter(
            (l) => l.referrerPrincipalId === r.principalId && l.status === "confirmed",
          ).length,
        }))
        .sort((x, y) => y.n - x.n || x.r.code.localeCompare(y.r.code));
      const wallet = await walletOf(tx, me.principalId);
      return {
        code: me.code,
        link: `/join?ref=${me.code}`,
        shareText: `Join me at OGC English — use my code ${me.code} when you enrol.`,
        program,
        performance: {
          clicks: Number(clicks.find((c) => c.code === me.code)?.clicks ?? 0),
          leads: mine.length,
          conversions,
          convRatePct: pct(conversions, mine.length),
        },
        myLeads: mine
          .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))
          .map((l) => ({ learnerName: l.learnerName, status: l.status, createdAt: l.createdAt })),
        wallet: { balanceVnd: wallet.balanceVnd, entries: [...wallet.entries].reverse() },
        leaderboard: board.map((x, i) => ({
          rank: i + 1,
          label: x.r.principalId === me.principalId ? "You" : `Ambassador #${i + 1}`,
          conversions: x.n,
          you: x.r.principalId === me.principalId,
        })),
      };
    });
    return out ?? reply.code(403).send({ error: "not_a_referrer" });
  });

  // ── staff: the referral funnel ─────────────────────────────────────────────────────────────
  app.secured("GET", "/v1/growth/leads", async (caller, _req, reply) => {
    if (!isStaff(caller)) return reply.code(403).send({ error: "not_staff" });
    return caller.tenant(async (tx) => {
      const b = await loadBook(tx);
      return b.leads.sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1)).map((l) => view(b, l));
    });
  });

  app.secured("GET", "/v1/growth/program", async (caller, _req, reply) => {
    if (!isStaff(caller)) return reply.code(403).send({ error: "not_staff" });
    return caller.tenant((tx) => programOf(tx));
  });

  const decide = (verb: "confirm" | "reject") =>
    app.secured("POST", `/v1/growth/leads/:id/${verb}`, async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = req.params as { id: string };
      await caller.write<Result>(
        `POST /v1/growth/leads/:id/${verb}`,
        { params, body },
        async (tx) => {
          let r: Result;
          if (!isStaff(caller)) r = no("not_staff");
          else if (!may(caller)) r = no("access_policy");
          else {
            // billing, then admissions — the order every billing write takes
            await sql`select pg_advisory_xact_lock(hashtext('billing:' || ${caller.ctx.orgId}))`.execute(
              tx,
            );
            await sql`select pg_advisory_xact_lock(hashtext('admissions:' || ${caller.ctx.orgId}))`.execute(
              tx,
            );
            r = await (verb === "confirm" ? confirm : reject)(tx, caller, params.id, body);
          }
          return {
            status: r.ok ? 200 : STATUS[r.reason],
            body: r,
            audit: {
              action: "growth:manage",
              resource: { leadId: params.id, step: verb },
              outcome: r.ok ? ("allowed" as const) : ("denied" as const),
              ...(r.ok ? {} : { reason: r.reason }),
            },
          };
        },
      );
    });

  async function confirm(tx: TenantTx, caller: Caller, id: string): Promise<Result> {
    const b = await loadBook(tx);
    const l = b.leads.find((x) => x.id === id);
    if (!l) return no("not_found");
    if (l.status !== "enrolled" || !l.firstPaymentVnd)
      return no("invalid_step", "confirm only after enrolment and the first payment");
    const flags = flagsOf(b, l);
    if (flags.length) return no("flagged", flags.join(", "));
    const program = await programOf(tx);
    const bonus = program.campaigns.find((c) => c.id === l.campaignId && c.active)?.bonusPct ?? 0;
    const p = program.rewardPct + bonus;
    const reward = Math.min(Math.round((l.firstPaymentVnd * p) / 100), program.capVnd);
    const at = new Date(caller.now());
    await tx
      .insertInto("referral_reward")
      .values({
        org_id: caller.ctx.orgId,
        lead_id: l.id,
        status: "confirmed",
        reward_vnd: reward,
        pct: p,
        at,
        by_name: await staffName(tx, caller),
        reason: null,
      })
      .execute();
    if (reward > 0)
      await addWalletEntry(tx, caller.ctx.orgId, {
        principalId: l.referrerPrincipalId,
        at,
        kind: "credit",
        amountVnd: reward,
        note: `Referral: ${l.learnerName} enrolled in ${l.courseCode} (${p}% of first payment${reward === program.capVnd ? ", capped" : ""}) — applied to your next invoice`,
        leadId: l.id,
      });
    return { ok: true };
  }

  async function reject(
    tx: TenantTx,
    caller: Caller,
    id: string,
    body: Record<string, unknown>,
  ): Promise<Result> {
    const b = await loadBook(tx);
    const l = b.leads.find((x) => x.id === id);
    if (!l) return no("not_found");
    if (l.status === "confirmed" || l.status === "rejected")
      return no("invalid_step", "already decided");
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 3) return no("invalid", "give a reason");
    await tx
      .insertInto("referral_reward")
      .values({
        org_id: caller.ctx.orgId,
        lead_id: l.id,
        status: "rejected",
        reward_vnd: null,
        pct: null,
        at: new Date(caller.now()),
        by_name: await staffName(tx, caller),
        reason: reason.slice(0, 200),
      })
      .execute();
    return { ok: true };
  }
  decide("confirm");
  decide("reject");

  // ── public: the /join page (no sign-in) ────────────────────────────────────────────────────
  const allow = rateLimiter(now);
  const lookup = async (raw: string) => {
    const code = raw.toUpperCase();
    if (!/^OGC[0-9A-Z]{6}$/.test(code)) return null;
    const r = await db
      .selectFrom("referral_code")
      .select(["org_id", "principal_id"])
      .where("code", "=", code)
      .executeTakeFirst();
    return r && UUID.test(r.org_id) ? { code, orgId: r.org_id, principalId: r.principal_id } : null;
  };
  const scope = (orgId: string, requestId: string) => ({
    orgId,
    principalId: "public",
    requestId,
  });

  app.get("/v1/public/referrals/:code", { config: { public: true } }, async (req, reply) => {
    if (!allow(`click|${req.ip}`, LIMITS.clicksPerAddress))
      return reply.code(429).send({ error: "too_many_requests" });
    const none = {
      valid: false,
      centerNames: [] as string[],
      courses: [] as { code: string; title: string }[],
    };
    const c = await lookup((req.params as { code: string }).code);
    if (!c) return none;
    return withTenant(db, scope(c.orgId, req.id), async (tx) => {
      const program = await programOf(tx);
      const me = (await referrers(tx)).find((r) => r.principalId === c.principalId);
      if (!program.enabled || !me) return none;
      await sql`insert into referral_click (org_id, code, clicks) values (${c.orgId}, ${c.code}, 1)
                on conflict (org_id, code) do update set clicks = referral_click.clicks + 1`.execute(
        tx,
      );
      const [centers, courses] = await Promise.all([
        tx.selectFrom("center").select("name").orderBy("name").execute(),
        tx.selectFrom("course").select(["code", "name"]).orderBy("code").execute(),
      ]);
      return {
        valid: true,
        centerNames: centers.map((x) => x.name),
        courses: courses.map((x) => ({ code: x.code, title: x.name })),
        campaigns: program.campaigns
          .filter((x) => x.active)
          .map((x) => ({ id: x.id, name: x.name })),
      };
    });
  });

  app.post("/v1/public/referrals/:code/leads", { config: { public: true } }, async (req, reply) => {
    const c = await lookup((req.params as { code: string }).code);
    if (!c) return reply.code(404).send({ ok: false, reason: "not_found" });
    if (
      !allow(`lead|${req.ip}`, LIMITS.leadsPerAddress) ||
      !allow(`lead-code|${c.code}`, LIMITS.leadsPerCode) ||
      !allow(`lead-org|${c.orgId}`, LIMITS.leadsPerOrg)
    )
      return reply.code(429).send({ ok: false, reason: "too_many_requests" });
    const d = (req.body ?? {}) as Record<string, unknown>;
    const r = await withTenant(db, scope(c.orgId, req.id), async (tx): Promise<Result> => {
      await sql`select pg_advisory_xact_lock(hashtext('admissions:' || ${c.orgId}))`.execute(tx);
      const program = await programOf(tx);
      const me = (await referrers(tx)).find((x) => x.principalId === c.principalId);
      let out: Result;
      const name =
        typeof d.learnerName === "string" ? d.learnerName.trim().replace(/\s+/g, " ") : "";
      const center = await tx
        .selectFrom("center")
        .select("id")
        .where("name", "=", typeof d.centerName === "string" ? d.centerName : "")
        .executeTakeFirst();
      const course = await tx
        .selectFrom("course")
        .select("code")
        .where("code", "=", typeof d.courseCode === "string" ? d.courseCode : "")
        .executeTakeFirst();
      if (!program.enabled || !me) out = no("not_found");
      else if (name.length < 2 || name.length > 60)
        out = no("invalid", "name must be 2–60 characters");
      else if (/\d{3,}|@|https?:/i.test(name))
        out = no("invalid", "a name only — no phone numbers, e-mail addresses or links");
      else if (!course) out = no("invalid", "unknown course");
      else if (!center) out = no("invalid", "unknown center");
      else {
        const camp =
          typeof d.campaignId === "string"
            ? program.campaigns.find((x) => x.id === d.campaignId && x.active)
            : undefined;
        await createReferralLead(
          tx,
          c.orgId,
          {
            learnerName: name,
            courseCode: course.code,
            centerId: center.id,
            referrerName: me.name,
            referrerPrincipalId: me.principalId,
            code: c.code,
            campaignId: camp?.id ?? null,
          },
          new Date(now()),
        );
        out = { ok: true };
      }
      await audit(tx, { orgId: c.orgId, principalId: "public", requestId: null } as never, req.id, {
        action: "growth:join",
        resource: { code: c.code },
        outcome: out.ok ? "allowed" : "denied",
        ...(out.ok ? {} : { reason: out.reason }),
      });
      return out;
    });
    return reply.code(r.ok ? 200 : STATUS[r.reason]).send(r);
  });
}
