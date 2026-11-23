// Partner Commissions on the Platform API (core): refer from Admissions ranked by fit, the ledger
// (staff record, an Org Admin approves — never their own step), tier rules with versions, signals
// that only suggest, and an append-only activity log.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  ActivityEntry,
  CommissionEntry,
  Lead,
  Partner,
  PartnerFit,
  PartnersOverview,
} from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { withTenant } from "./db.js";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "partners-test-secret-0123456789ab";
const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time
const DAY = 86_400_000;
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const TARA = "iios-principal-teacher-1";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `ptn-${Date.now()}-${++seq}-abc`;
const lotusV2 = {
  cycle: "monthly",
  mode: "progressive",
  tiers: [
    { minCount: 1, amountVnd: 1_200_000 },
    { minCount: 4, amountVnd: 2_200_000 },
  ],
  attributionWindowDays: 60,
  clawbackWindowDays: 7,
};

describe.skipIf(!hasPg)("partners — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;
  let now = NOW;

  beforeAll(async () => {
    ({ app: iios, state } = buildIiosMock({
      key: randomBytes(32),
      clientId: "ogc",
      clientSecret: SECRET,
    }));
    await iios.listen({ host: "127.0.0.1", port: 0 });
    iiosUrl = `http://127.0.0.1:${(iios.server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await api?.close();
    await t?.drop();
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
    state.attachments.clear();
    now = NOW;
    api = buildApi({
      db: t.app,
      iios: httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
      now: () => now,
    });
    await api.ready();
  });
  afterAll(async () => {
    await api?.close();
    await iios?.close();
    await t?.drop();
  });

  const as = async (principalId: string, orgId = NOVA) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId }),
    });
    const g = ((await r.json()) as { grant: string }).grant;
    return (method: "GET" | "POST" | "PUT", url: string, body?: unknown) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": orgId,
          ...(method !== "GET" ? { "idempotency-key": key() } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
  };
  type Call = Awaited<ReturnType<typeof as>>;
  const overview = async (c: Call) =>
    (await c("GET", "/v1/partners/overview")).json() as PartnersOverview;
  const entries = async (c: Call) =>
    (await c("GET", "/v1/partners/entries")).json() as CommissionEntry[];
  const entry = async (c: Call, name: string) =>
    (await entries(c)).find((e) => e.learnerDisplayName === name)!;
  const partners = async (c: Call) => (await c("GET", "/v1/partners")).json() as Partner[];
  const leadOf = async (c: Call, name: string) =>
    ((await c("GET", "/v1/admissions/leads")).json() as Lead[]).find(
      (l) => l.learnerName === name,
    )!;

  it("seeds the demo's partners, rules and ledger; the overview adds up", async () => {
    const sam = await as(SAM);
    const ps = await partners(sam);
    expect(ps.map((p) => [p.name, p.rule?.version, p.pendingRule?.version ?? null])).toEqual([
      ["Hanoi Bridge English — Dong Da", 1, null],
      ["Lotus English — Binh Thanh", 1, null],
      ["Sao Mai IELTS Academy — District 3", 1, 2],
    ]);
    expect(ps.find((p) => p.id === "PTN-LOTUS")!.nearCenters).toEqual([
      "Nova English — District 1",
      "Nova English — Thu Duc",
    ]);
    const es = await entries(sam);
    expect(es).toHaveLength(15);
    expect(
      es
        .filter((e) => e.status === "paid")
        .map((e) => [e.learnerDisplayName, e.amountVnd, e.settledBatchId])
        .sort(),
    ).toEqual([
      ["Ha T.", 1_000_000, "ST-LOTUS-01"],
      ["Long V.", 1_000_000, "ST-LOTUS-01"],
      ["Vinh Q.", 800_000, "ST-BRIDGE-01"],
    ]);
    // every paid / approved entry was approved after it enrolled, and enrolled after its referral
    for (const e of es)
      if (e.enrolledAt) expect(Date.parse(e.enrolledAt)).toBeGreaterThan(Date.parse(e.referredAt));
    const o = await overview(sam);
    expect(o.kpis).toEqual({
      receivedVnd: 2_800_000,
      awaitingPaymentVnd: 1_000_000,
      awaitingEnrolment: 4,
      nextTierUpliftVnd: 1_000_000,
    });
    expect(o).toMatchObject({ canManage: true, isOrgAdmin: false });
    const lotus = o.partners.find((p) => p.partnerId === "PTN-LOTUS")!;
    expect(lotus).toMatchObject({
      cycleCount: 3,
      currentTierAmountVnd: 1_000_000,
      nextTier: { at: 4, amountVnd: 2_000_000 },
      overdueVnd: 1_000_000,
    });
    expect(o.signals.map((s) => `${s.rule}:${s.partnerId}`).sort()).toEqual([
      "high_rejection_rate:PTN-SAOMAI",
      "near_next_tier:PTN-LOTUS",
      "near_next_tier:PTN-SAOMAI",
      "overdue_settlement:PTN-LOTUS",
      "stale_referral:PTN-LOTUS",
      "stale_referral:PTN-SAOMAI",
    ]);
    expect(o.signals.every((s) => s.state === "open" && s.evidence.length > 0)).toBe(true);
    expect(o.signals.find((s) => s.rule === "high_rejection_rate")!.message).toMatch(
      /2 of 4 .* \(50%, above 25%\)/,
    );
    // a retroactive quarter: provisional until it ends; approvable from the cycle end
    const khanh = await entry(sam, "Khanh D.");
    expect(khanh).toMatchObject({
      provisional: true,
      amountVnd: 1_500_000,
      cycleLabel: "Q4 2026",
      approvableFrom: "2026-12-31T17:00:00.000Z",
    });
  });

  it("refer from Admissions: ranked by fit only; the lead closes; one referral per lead", async () => {
    const sam = await as(SAM);
    const duc = await leadOf(sam, "Duc A."); // ENG-A2 at Cau Giay
    const fit = (await sam("GET", `/v1/partners/suggest/${duc.id}`)).json() as PartnerFit[];
    expect(fit.map((f) => [f.partnerName, f.fits])).toEqual([
      ["Hanoi Bridge English — Dong Da", true],
      ["Lotus English — Binh Thanh", true],
      ["Sao Mai IELTS Academy — District 3", false],
    ]);
    expect(fit[0].reasons).toEqual([
      "teaches ENG-A2",
      "near the learner's center",
      "68% of referred learners still learning after 3 months",
    ]);
    expect(fit[0].commissionInfo).toMatch(/per learner/);

    const bad = await sam("POST", "/v1/partners/refer", {
      leadId: duc.id,
      partnerId: "PTN-SAOMAI",
    });
    expect([bad.statusCode, bad.json().detail]).toEqual([
      422,
      "Sao Mai IELTS Academy — District 3 does not teach ENG-A2",
    ]);
    const r = await sam("POST", "/v1/partners/refer", { leadId: duc.id, partnerId: "PTN-BRIDGE" });
    expect(r.statusCode).toBe(200);
    const e = await entry(sam, "Duc A.");
    expect(e).toMatchObject({
      leadRefCode: "LR-1016",
      status: "referred",
      courseCode: "ENG-A2",
      expiresAt: new Date(NOW + 30 * DAY).toISOString(),
    });
    expect(await leadOf(sam, "Duc A.")).toMatchObject({
      stage: "lost",
      lostReason: "Referred to partner: Hanoi Bridge English — Dong Da",
    });
    const again = await sam("POST", "/v1/partners/refer", {
      leadId: duc.id,
      partnerId: "PTN-LOTUS",
    });
    expect(again.statusCode).toBe(409);

    // a lead whose first invoice is open cannot go out
    const yen = await leadOf(sam, "Yen T.");
    await sam("POST", "/v1/billing/invoices/first", { leadId: yen.id });
    const out = await sam("POST", "/v1/partners/refer", { leadId: yen.id, partnerId: "PTN-LOTUS" });
    expect([out.statusCode, out.json().detail]).toEqual([
      409,
      expect.stringMatching(/first invoice .* is open/),
    ]);
    const log = (await sam("GET", "/v1/partners/activity")).json() as ActivityEntry[];
    expect(log[0]).toMatchObject({
      by: "Sam (Org Staff)",
      action: "referred",
      subject: "Duc A. (LR-1016) → Hanoi Bridge English — Dong Da",
    });
  });

  it("ledger: staff record, an Org Admin approves after the clawback window — never their own step", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    // Quan B. enrolled 01/11 (recorded by Sam), Lotus clawback 7 days
    const quan = await entry(sam, "Quan B.");
    expect((await sam("POST", `/v1/partners/entries/${quan.id}/approve`, {})).json().reason).toBe(
      "not_org_admin",
    );
    const a = await olivia("POST", `/v1/partners/entries/${quan.id}/approve`, {});
    expect(a.statusCode).toBe(200);
    expect(await entry(sam, "Quan B.")).toMatchObject({
      status: "approved",
      amountVnd: 1_000_000,
      appliedTierIndex: 1,
      dueDate: new Date(NOW + 15 * DAY).toISOString(),
      updatedBy: "Olivia (Org Admin)",
    });
    expect((await olivia("POST", `/v1/partners/entries/${quan.id}/approve`, {})).statusCode).toBe(
      409,
    );

    // Olivia records Hoa G.'s enrolment, then cannot approve it; and not before the clawback ends
    const hoa = await entry(sam, "Hoa G.");
    expect((await olivia("POST", `/v1/partners/entries/${hoa.id}/enrolled`, {})).statusCode).toBe(
      200,
    );
    const own = await olivia("POST", `/v1/partners/entries/${hoa.id}/approve`, {});
    expect([own.statusCode, own.json().reason]).toEqual([403, "own_step"]);
    const mai = await entry(sam, "Mai L.");
    await sam("POST", `/v1/partners/entries/${mai.id}/enrolled`, {});
    expect(await entry(sam, "Mai L.")).toMatchObject({
      status: "enrolled",
      appliedRuleVersion: 1,
      appliedTierIndex: 2,
      amountVnd: 2_000_000,
    });
    const early = await olivia("POST", `/v1/partners/entries/${mai.id}/approve`, {});
    expect([early.statusCode, early.json().detail]).toEqual([
      409,
      "not before 30/11/2026 (clawback window)",
    ]);
    // a retroactive quarter waits for the cycle end
    const khanh = await entry(sam, "Khanh D.");
    expect(
      (await olivia("POST", `/v1/partners/entries/${khanh.id}/approve`, {})).json().detail,
    ).toMatch(/cycle end/);
    // after the clawback: approved, locked at the tier it reached
    now = NOW + 8 * DAY;
    expect((await olivia("POST", `/v1/partners/entries/${mai.id}/approve`, {})).statusCode).toBe(
      200,
    );
    expect(await entry(sam, "Mai L.")).toMatchObject({ status: "approved", amountVnd: 2_000_000 });
  });

  it("reject needs a reason; closed entries stay closed; the attribution window is enforced", async () => {
    const sam = await as(SAM);
    const son = await entry(sam, "Son K.");
    expect(
      (await sam("POST", `/v1/partners/entries/${son.id}/reject`, { reason: "no" })).statusCode,
    ).toBe(422);
    expect(
      (await sam("POST", `/v1/partners/entries/${son.id}/reject`, { reason: "Call 0903123456" }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await sam("POST", `/v1/partners/entries/${son.id}/reject`, {
          reason: "Chose another school",
        })
      ).statusCode,
    ).toBe(200);
    expect(await entry(sam, "Son K.")).toMatchObject({
      status: "rejected",
      rejectReason: "Chose another school",
    });
    expect((await sam("POST", `/v1/partners/entries/${son.id}/enrolled`, {})).statusCode).toBe(409);
    const ha = await entry(sam, "Ha T."); // paid
    expect(
      (await sam("POST", `/v1/partners/entries/${ha.id}/reject`, { reason: "Changed mind" }))
        .statusCode,
    ).toBe(409);
    // Tuan M. was referred 25 days ago to Sao Mai (30-day window): 6 days later it has ended
    now = NOW + 6 * DAY;
    const tuan = await entry(sam, "Tuan M.");
    const late = await sam("POST", `/v1/partners/entries/${tuan.id}/enrolled`, {});
    expect([late.statusCode, late.json().detail]).toEqual([
      409,
      expect.stringMatching(/attribution window ended .* reject it instead/),
    ]);
  });

  it("tier rules: staff propose a version; another Org Admin activates; earlier entries keep theirs", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    expect(
      (
        await sam("POST", "/v1/partners/PTN-LOTUS/rules", {
          ...lotusV2,
          tiers: [{ minCount: 2, amountVnd: 1 }],
        })
      ).json().detail,
    ).toBe("the first tier starts at 1");
    expect(
      (await sam("POST", "/v1/partners/PTN-LOTUS/rules", { ...lotusV2, attributionWindowDays: 3 }))
        .statusCode,
    ).toBe(422);
    expect(
      (await sam("POST", "/v1/partners/PTN-LOTUS/rules", { cycle: "weekly" })).statusCode,
    ).toBe(422);
    expect((await sam("POST", "/v1/partners/PTN-LOTUS/rules", lotusV2)).statusCode).toBe(200);
    expect((await sam("POST", "/v1/partners/PTN-LOTUS/rules", lotusV2)).json().detail).toBe(
      "a version is already waiting for an Org Admin",
    );
    const pending = (await partners(sam)).find((p) => p.id === "PTN-LOTUS")!.pendingRule!;
    expect(pending).toMatchObject({
      version: 2,
      status: "pending",
      proposedBy: "Sam (Org Staff)",
      mine: true,
    });
    expect((await sam("POST", `/v1/partners/rules/${pending.id}/activate`, {})).json().reason).toBe(
      "not_org_admin",
    );
    expect((await olivia("POST", `/v1/partners/rules/${pending.id}/activate`, {})).statusCode).toBe(
      200,
    );
    const lotus = (await partners(sam)).find((p) => p.id === "PTN-LOTUS")!;
    expect(lotus.rule).toMatchObject({ version: 2, decidedBy: "Olivia (Org Admin)" });
    expect(lotus.history.map((r) => [r.version, r.status])).toEqual([
      [2, "active"],
      [1, "retired"],
    ]);
    // Quan B. keeps v1; a new enrolment uses v2 (4th of November → tier 2 = 2.200.000)
    expect(await entry(sam, "Quan B.")).toMatchObject({
      appliedRuleVersion: 1,
      amountVnd: 1_000_000,
    });
    const mai = await entry(sam, "Mai L.");
    await sam("POST", `/v1/partners/entries/${mai.id}/enrolled`, {});
    expect(await entry(sam, "Mai L.")).toMatchObject({
      appliedRuleVersion: 2,
      amountVnd: 2_200_000,
    });

    // Olivia cannot activate her own proposal; rejecting someone else's works
    await olivia("POST", "/v1/partners/PTN-BRIDGE/rules", {
      ...lotusV2,
      attributionWindowDays: 30,
    });
    const own = (await partners(olivia)).find((p) => p.id === "PTN-BRIDGE")!.pendingRule!;
    expect((await olivia("POST", `/v1/partners/rules/${own.id}/activate`, {})).json().reason).toBe(
      "own_step",
    );
    const saomai = (await partners(olivia)).find((p) => p.id === "PTN-SAOMAI")!.pendingRule!;
    expect((await olivia("POST", `/v1/partners/rules/${saomai.id}/reject`, {})).statusCode).toBe(
      200,
    );
    expect((await partners(olivia)).find((p) => p.id === "PTN-SAOMAI")).toMatchObject({
      pendingRule: null,
      rule: { version: 1 },
    });
  });

  it("signals only suggest: follow, snooze (7 days) or dismiss with a reason — nothing else changes", async () => {
    const sam = await as(SAM);
    const before = await overview(sam);
    const stale = before.signals.find(
      (s) => s.rule === "stale_referral" && s.partnerId === "PTN-LOTUS",
    )!;
    const overdue = before.signals.find((s) => s.rule === "overdue_settlement")!;
    const near = before.signals.find(
      (s) => s.rule === "near_next_tier" && s.partnerId === "PTN-LOTUS",
    )!;
    expect(
      (await sam("POST", "/v1/partners/signals/act", { signalId: stale.id, action: "dismiss" }))
        .statusCode,
    ).toBe(422);
    expect(
      (await sam("POST", "/v1/partners/signals/act", { signalId: "nope", action: "follow" }))
        .statusCode,
    ).toBe(404);
    await sam("POST", "/v1/partners/signals/act", {
      signalId: stale.id,
      action: "dismiss",
      note: "Partner confirmed by phone call",
    });
    await sam("POST", "/v1/partners/signals/act", { signalId: overdue.id, action: "snooze" });
    await sam("POST", "/v1/partners/signals/act", { signalId: near.id, action: "follow" });
    const after = await overview(sam);
    const st = (id: string) => after.signals.find((s) => s.id === id);
    expect([st(stale.id)?.state, st(stale.id)?.note]).toEqual([
      "dismissed",
      "Partner confirmed by phone call",
    ]);
    expect(st(overdue.id)?.state).toBe("snoozed");
    expect(st(near.id)?.state).toBe("followed");
    expect(after.signals.slice(0, 3).every((s) => s.state === "open")).toBe(true);
    expect(after.kpis).toEqual(before.kpis); // nothing changed status or money
    // a snooze ends after 7 days
    now = NOW + 8 * DAY;
    expect((await overview(sam)).signals.find((s) => s.id === overdue.id)?.state).toBe("open");
    const log = (await sam("GET", "/v1/partners/activity")).json() as ActivityEntry[];
    expect(log.map((a) => a.action)).toEqual([
      "signal followed",
      "signal snoozed 7 days",
      "signal dismissed",
    ]);
  });

  it("suggestions put partners that teach the course first, even at the same score", async () => {
    const c = new pg.Client({ connectionString: t.ownerUrl });
    await c.connect();
    try {
      await c.query("select set_config('app.org_id', $1, false)", [NOVA]);
      // same score (50): teaches A2, not near, 0% retention vs. does not teach A2, near, 100%
      await c.query(
        `insert into partner (org_id, id, name, courses, near_center_ids, retention_pct, settlement_days) values
          ($1, 'PTN-ZETA', 'Zeta Teach', '{ENG-A2}', '{}', 0, 15),
          ($1, 'PTN-ALPHA', 'Alpha Near', '{IELTS-B2}', '{00000000-0000-4000-8000-000000000c03}', 100, 15)`,
        [NOVA],
      );
    } finally {
      await c.end();
    }
    const sam = await as(SAM);
    const duc = await leadOf(sam, "Duc A.");
    const fit = (await sam("GET", `/v1/partners/suggest/${duc.id}`)).json() as PartnerFit[];
    const names = fit.map((f) => f.partnerName);
    expect(names.indexOf("Zeta Teach")).toBeLessThan(names.indexOf("Alpha Near"));
    expect(fit.findIndex((f) => !f.fits)).toBe(fit.filter((f) => f.fits).length);
  });

  it("an approved amount stays locked when the cycle's count later changes", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    const mai = await entry(sam, "Mai L.");
    await sam("POST", `/v1/partners/entries/${mai.id}/enrolled`, {}); // 4th in November → 2.000.000
    now = NOW + 8 * DAY;
    await olivia("POST", `/v1/partners/entries/${mai.id}/approve`, {});
    const nhi = await entry(sam, "Nhi P.");
    await sam("POST", `/v1/partners/entries/${nhi.id}/reject`, { reason: "Partner withdrew it" });
    // Mai L. is now the 3rd counted enrolment of November, but her approved amount does not move
    expect(await entry(sam, "Mai L.")).toMatchObject({
      status: "approved",
      amountVnd: 2_000_000,
      appliedTierIndex: 2,
    });
  });

  it("one referral per lead, even for a lead that is still open", async () => {
    const sam = await as(SAM);
    const hoa = await leadOf(sam, "Hoa P.");
    await withTenant(t.app, { orgId: NOVA, principalId: SAM, requestId: "x" }, (tx) =>
      tx
        .insertInto("commission_entry")
        .values({
          org_id: NOVA,
          id: "CE-99",
          partner_id: "PTN-LOTUS",
          lead_id: hoa.id,
          lead_ref_code: "LR-9999",
          learner_display_name: "Hoa P.",
          course_code: "ENG-A2",
          referred_at: new Date(NOW),
          expires_at: new Date(NOW + 60 * DAY),
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
          updated_by_name: "x",
          updated_at: new Date(NOW),
        })
        .execute(),
    );
    const r = await sam("POST", "/v1/partners/refer", { leadId: hoa.id, partnerId: "PTN-LOTUS" });
    expect([r.statusCode, r.json().detail]).toEqual([
      409,
      "this lead was already referred to a partner",
    ]);
  });

  it("a high rejection rate needs at least 4 decided referrals", async () => {
    const sam = await as(SAM);
    const hoaG = await entry(sam, "Hoa G."); // Hanoi Bridge: nothing else decided in 30 days
    await sam("POST", `/v1/partners/entries/${hoaG.id}/reject`, {
      reason: "Moved to another city",
    });
    const sig = (await overview(sam)).signals
      .filter((s) => s.rule === "high_rejection_rate")
      .map((s) => s.partnerId);
    expect(sig).toEqual(["PTN-SAOMAI"]);
  });

  it("partners:manage for the module, admissions:manage at the lead's center for a referral", async () => {
    const olivia = await as(OLIVIA);
    // partners:manage everywhere, admissions only at District 1
    const created = await olivia("POST", "/v1/access/policies", {
      name: "Partners desk",
      rules: [
        { action: "partners:manage" },
        {
          action: "admissions:manage",
          criteria: { centerId: ["00000000-0000-4000-8000-000000000c01"] },
        },
      ],
    });
    expect(created.statusCode).toBe(200);
    const ref = [...state.policies.values()].find((p) => p.name === "Partners desk")!.ref;
    state.attachments.set(SAM, ref);
    const sam = await as(SAM);
    expect((await sam("GET", "/v1/partners/overview")).statusCode).toBe(200);
    const duc = await leadOf(olivia, "Duc A."); // Cau Giay
    const out = await sam("POST", "/v1/partners/refer", {
      leadId: duc.id,
      partnerId: "PTN-BRIDGE",
    });
    expect([out.statusCode, out.json().reason]).toEqual([403, "access_policy"]);
    const hoa = await leadOf(olivia, "Hoa P."); // District 1
    expect(
      (await sam("POST", "/v1/partners/refer", { leadId: hoa.id, partnerId: "PTN-LOTUS" }))
        .statusCode,
    ).toBe(200);
    // without partners:manage, no partner write at all — even at District 1
    state.attachments.set(SAM, "policy-front-desk-d1");
    const fd = await as(SAM);
    const quan = await entry(olivia, "Quan B.");
    const rj = await fd("POST", `/v1/partners/entries/${quan.id}/reject`, { reason: "Not ours" });
    expect([rj.statusCode, rj.json().reason]).toEqual([403, "access_policy"]);
    const ngoc = await leadOf(olivia, "Ngoc D."); // District 1
    expect(
      (await fd("POST", "/v1/partners/refer", { leadId: ngoc.id, partnerId: "PTN-LOTUS" }))
        .statusCode,
    ).toBe(403);
  });

  it("access: staff with partners:manage only; the Org Admin flag; tenants isolated; logs append-only", async () => {
    expect((await (await as(TARA))("GET", "/v1/partners/overview")).statusCode).toBe(403);
    state.attachments.set(SAM, "policy-front-desk-d1"); // no partners:manage rule
    const narrowed = await as(SAM);
    expect((await narrowed("GET", "/v1/partners/overview")).statusCode).toBe(403);
    const duc = await leadOf(await as(OLIVIA), "Duc A.");
    expect(
      (await narrowed("POST", "/v1/partners/refer", { leadId: duc.id, partnerId: "PTN-BRIDGE" }))
        .statusCode,
    ).toBe(403);
    expect((await overview(await as(OLIVIA))).isOrgAdmin).toBe(true);
    const lumen = await as(LUMEN_STAFF, LUMEN);
    expect(await partners(lumen)).toEqual([]);
    expect(await entries(lumen)).toEqual([]);
    const quan = await entry(await as(OLIVIA), "Quan B.");
    expect(
      (await lumen("POST", `/v1/partners/entries/${quan.id}/reject`, { reason: "Not ours" }))
        .statusCode,
    ).toBe(404);
    const scope = { orgId: NOVA, principalId: SAM, requestId: "x" };
    await expect(
      withTenant(t.app, scope, (tx) =>
        tx.updateTable("partner_activity").set({ action: "x" }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) => tx.deleteFrom("commission_entry").execute()),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) =>
        tx.updateTable("partner").set({ retention_pct: 99 }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) =>
        tx.updateTable("commission_entry").set({ lead_ref_code: "LR-1" }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
