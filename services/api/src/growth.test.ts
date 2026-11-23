// Growth · referrals on the Platform API (owner 23/11, slice 6 part A): links for guardians and
// adult learners, the public /join page (rate-limited), anti-fraud flags, confirming a reward, and
// the wallet credit Billing applies to the referrer's later invoices.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Invoice, Lead, MyBilling, MyReferrals, ReferralLead } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { codeOf } from "./domains/growth.js";
import { LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "growth-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time; Term 1 ends 30/11
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const LUMEN_LEARNER = "iios-principal-learner-org2";
const MAI = "iios-principal-guardian-1";
const LINH = "iios-principal-learner-1";
const MINH = "iios-principal-learner-2";
const YEAR = "2026-2027";
let seq = 0;
const key = () => `grow-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("growth · referrals — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;

  beforeAll(async () => {
    ({ app: iios, state } = buildIiosMock({
      key: randomBytes(32),
      clientId: "ogc",
      clientSecret: SECRET,
    }));
    await iios.listen({ host: "127.0.0.1", port: 0 });
    iiosUrl = `http://127.0.0.1:${(iios.server.address() as AddressInfo).port}`;
  });
  let now = NOW;
  beforeEach(async () => {
    now = NOW;
    await api?.close();
    await t?.drop();
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
    state.attachments.clear();
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
  const invoices = async (c: Call) => (await c("GET", "/v1/billing/invoices")).json() as Invoice[];
  const mine = async (c: Call) => (await c("GET", "/v1/me/referrals")).json() as MyReferrals;
  const funnel = async (c: Call) => (await c("GET", "/v1/growth/leads")).json() as ReferralLead[];
  const ref = async (c: Call, name: string) =>
    (await funnel(c)).find((l) => l.learnerName === name)!;
  const leadOf = async (c: Call, name: string) =>
    ((await c("GET", "/v1/admissions/leads")).json() as Lead[]).find(
      (l) => l.learnerName === name,
    )!;
  const ownerQuery = async (q: string, params: unknown[] = []) => {
    const c = new pg.Client({ connectionString: t.ownerUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.org_id', $1, true)", [NOVA]);
      const r = await c.query(q, params);
      await c.query("commit");
      return r;
    } finally {
      await c.end();
    }
  };
  const pub = (method: "GET" | "POST", url: string, body?: object, ip = "203.0.113.7") =>
    api.inject({
      method,
      url,
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": ip },
      ...(body ? { payload: body } : {}),
    });
  const join = (code: string, learnerName: string, extra: object = {}, ip?: string) =>
    pub(
      "POST",
      `/v1/public/referrals/${code}/leads`,
      {
        learnerName,
        courseCode: "ENG-A2",
        centerName: "Nova English — District 1",
        ...extra,
      },
      ip,
    );
  const MAI_CODE = codeOf(MAI);
  const MINH_CODE = codeOf(MINH);

  it("guardians and adult learners get a link; minors, teachers and staff do not", async () => {
    const m = await mine(await as(MAI));
    expect(m).toMatchObject({
      code: MAI_CODE,
      link: `/join?ref=${MAI_CODE}`,
      program: { enabled: true, rewardPct: 5, capVnd: 2_000_000 },
      performance: { clicks: 5, leads: 2, conversions: 0, convRatePct: 0 },
      wallet: { balanceVnd: 0, entries: [] },
    });
    expect(m.myLeads.map((l) => [l.learnerName, l.status])).toEqual([
      ["Linh N.", "lead"],
      ["Bao T.", "enrolled"],
    ]);
    expect(m.leaderboard.map((x) => x.label.replace(/#\d/, "#n")).sort()).toEqual([
      "Ambassador #n",
      "You",
    ]);
    expect(m.leaderboard.filter((x) => x.you)).toHaveLength(1);
    const minh = await mine(await as(MINH));
    expect([minh.code, minh.performance.leads]).toEqual([MINH_CODE, 0]);
    for (const p of [LINH, TARA, SAM])
      expect((await (await as(p))("GET", "/v1/me/referrals")).statusCode).toBe(403);
    expect((await (await as(LUMEN_LEARNER, LUMEN))("GET", "/v1/me/referrals")).statusCode).toBe(
      403,
    );
  });

  it("/join: a click is counted; a lead takes a name, a course and a center — nothing else", async () => {
    const g = await pub("GET", `/v1/public/referrals/${MAI_CODE.toLowerCase()}`);
    expect(g.json()).toMatchObject({
      valid: true,
      centerNames: [
        "Nova English — District 1",
        "Nova English — Thu Duc",
        "Nova Juniors — Cau Giay",
      ],
      campaigns: [{ id: "camp-tet-2027", name: "Tết 2027 — bring a friend" }],
    });
    expect(g.json().courses.map((c: { code: string }) => c.code)).toContain("ENG-A2");
    expect((await mine(await as(MAI))).performance.clicks).toBe(6);
    expect((await pub("GET", "/v1/public/referrals/OGCZZZZZZ")).json()).toEqual({
      valid: false,
      centerNames: [],
      courses: [],
    });
    expect((await pub("GET", "/v1/public/referrals/<script>")).json().valid).toBe(false);

    for (const [name, extra, detail] of [
      ["A", {}, "name must be 2–60 characters"],
      ["Bin 0901234567", {}, /no phone numbers/],
      ["bin@example.org", {}, /no phone numbers/],
      ["Bin K.", { courseCode: "ENG-Z9" }, "unknown course"],
      ["Bin K.", { centerName: "Elsewhere" }, "unknown center"],
    ] as const) {
      const r = await join(MAI_CODE, name, extra, `198.51.100.${name.length}`);
      expect(r.statusCode).toBe(422);
      expect(r.json().detail).toMatch(detail);
    }
    expect((await join("OGCZZZZZZ", "Bin K.")).statusCode).toBe(404);
    const ok = await join(MAI_CODE, "  Bin   K. ", { campaignId: "camp-tet-2027" });
    expect(ok.json()).toEqual({ ok: true });
    const l = await leadOf(await as(SAM), "Bin K.");
    expect(l).toMatchObject({
      source: "referral",
      stage: "new",
      referredBy: "Mai (Guardian)",
      campaignId: "camp-tet-2027",
    });
    expect(l.stageHistory[0]).toMatchObject({ stage: "new", by: `Referral (${MAI_CODE})` });
    const audit = await ownerQuery(
      "select principal_id, action, outcome, resource from audit_event where action = 'growth:join' order by at",
    );
    expect(audit.rows.at(-1)).toMatchObject({
      principal_id: "public",
      action: "growth:join",
      outcome: "allowed",
      resource: { code: MAI_CODE },
    });
    // An ended campaign is not recorded.
    await ownerQuery("update referral_campaign set active = false");
    await join(MAI_CODE, "Dat V.", { campaignId: "camp-tet-2027" }, "198.51.100.77");
    expect((await leadOf(await as(SAM), "Dat V.")).campaignId).toBeNull();
    // A paused program takes nothing.
    await ownerQuery("update referral_program set enabled = false");
    expect((await pub("GET", `/v1/public/referrals/${MAI_CODE}`)).json().valid).toBe(false);
    expect((await join(MAI_CODE, "Cam L.")).statusCode).toBe(404);
  });

  it("/join is rate-limited per address (from nginx's X-Forwarded-For); others are not held up", async () => {
    for (let i = 0; i < 5; i++)
      expect((await join(MAI_CODE, `Friend ${String.fromCharCode(65 + i)}.`)).statusCode).toBe(200);
    const sixth = await join(MAI_CODE, "Friend F.");
    expect([sixth.statusCode, sixth.json().reason]).toEqual([429, "too_many_requests"]);
    expect((await join(MAI_CODE, "Friend G.", {}, "192.0.2.44")).statusCode).toBe(200);
    // the limit waits out its window
    now += 11 * 60_000;
    expect((await join(MAI_CODE, "Friend H.")).statusCode).toBe(200);
    // clicks too
    let last = 0;
    for (let i = 0; i < 61; i++)
      last = (await pub("GET", `/v1/public/referrals/${MAI_CODE}`, undefined, "192.0.2.9"))
        .statusCode;
    expect(last).toBe(429);
  });

  it("anti-fraud: names compared without case, punctuation or diacritics", async () => {
    const sam = await as(SAM);
    expect((await ref(sam, "Linh N.")).flags).toEqual(["same_household", "duplicate"]);
    expect((await ref(sam, "Bao T.")).flags).toEqual([]);
    await join(MAI_CODE, 'Lính  N."', { centerName: "Nova English — Thu Duc" }, "192.0.2.1");
    expect((await ref(sam, 'Lính N."')).flags).toEqual(["same_household"]);
    await join(MINH_CODE, "minh t", {}, "192.0.2.2");
    expect((await ref(sam, "minh t")).flags).toEqual(["self_referral", "duplicate"]);
    await join(MINH_CODE, "Hoa P.", {}, "192.0.2.3"); // an open walk-in lead at District 1
    expect((await ref(sam, "Hoa P.")).flags).toEqual(["duplicate"]);
  });

  it("confirm: only enrolled-and-paid, unflagged, by staff with growth:manage; the credit lands in the wallet", async () => {
    const sam = await as(SAM);
    const bao = await ref(sam, "Bao T.");
    expect(bao).toMatchObject({
      status: "enrolled",
      firstPaymentVnd: 6_900_000,
      invoiceNo: "INV-2026-0008",
    });
    const linh = await ref(sam, "Linh N.");
    const early = await sam("POST", `/v1/growth/leads/${linh.id}/confirm`, {});
    expect([early.statusCode, early.json().reason]).toEqual([409, "invalid_step"]);
    const tara = await (await as(TARA))("POST", `/v1/growth/leads/${bao.id}/confirm`, {});
    expect([tara.statusCode, tara.json().reason]).toEqual([403, "not_staff"]);
    const mai = await (await as(MAI))("POST", `/v1/growth/leads/${bao.id}/confirm`, {});
    expect(mai.statusCode).toBe(403);
    state.attachments.set(SAM, "policy-front-desk-d1"); // no growth:manage
    const fd = await (await as(SAM))("POST", `/v1/growth/leads/${bao.id}/confirm`, {});
    expect([fd.statusCode, fd.json().reason]).toEqual([403, "access_policy"]);
    state.attachments.delete(SAM);
    expect((await sam("POST", `/v1/growth/leads/${bao.id}/confirm`, {})).json()).toEqual({
      ok: true,
    });
    expect(await ref(sam, "Bao T.")).toMatchObject({ status: "confirmed", rewardVnd: 483_000 });
    const twice = await sam("POST", `/v1/growth/leads/${bao.id}/confirm`, {});
    expect([twice.statusCode, twice.json().reason]).toEqual([409, "invalid_step"]);
    const w = (await mine(await as(MAI))).wallet;
    expect(w.balanceVnd).toBe(483_000);
    expect(w.entries[0].note).toMatch(/Bao T\. enrolled in ENG-A2 \(7% of first payment\)/);
    expect((await mine(await as(MAI))).performance.conversions).toBe(1);
    // the same new learner is never rewarded twice
    await join(MINH_CODE, "Bảo T", { centerName: "Nova English — Thu Duc" }, "192.0.2.5");
    expect((await ref(sam, "Bảo T")).flags).toEqual(["already_rewarded"]);
    // reject: a reason; never a decided lead
    const flagged = await ref(sam, "Linh N.");
    expect(
      (await sam("POST", `/v1/growth/leads/${flagged.id}/reject`, { reason: " " })).statusCode,
    ).toBe(422);
    expect(
      (await sam("POST", `/v1/growth/leads/${flagged.id}/reject`, { reason: "Own child" })).json(),
    ).toEqual({ ok: true });
    expect(await ref(sam, "Linh N.")).toMatchObject({
      status: "rejected",
      rejectedReason: "Own child",
    });
    expect(
      (await sam("POST", `/v1/growth/leads/${bao.id}/reject`, { reason: "Changed" })).statusCode,
    ).toBe(409);
  });

  it("a flagged lead is never confirmed; a big first payment is capped", async () => {
    const sam = await as(SAM);
    // Make Linh's referral enrolled-and-paid by data, keeping the flags.
    await ownerQuery(
      "update lead set stage = 'enrolled', first_payment_vnd = 6900000 where learner_name = 'Linh N.' and source = 'referral'",
    );
    const linh = await ref(sam, "Linh N.");
    const r = await sam("POST", `/v1/growth/leads/${linh.id}/confirm`, {});
    expect([r.statusCode, r.json().reason, r.json().detail]).toEqual([
      409,
      "flagged",
      "same_household, duplicate",
    ]);
    await ownerQuery("update referral_program set reward_pct = 30");
    const bao = await ref(sam, "Bao T.");
    await sam("POST", `/v1/growth/leads/${bao.id}/confirm`, {});
    expect((await ref(sam, "Bao T.")).rewardVnd).toBe(2_000_000);
    expect((await mine(await as(MAI))).wallet.entries[0].note).toMatch(/capped/);
  });

  it("the credit goes to the referrer's next invoice, never more than it; a void gives it back", async () => {
    const sam = await as(SAM);
    const bao = await ref(sam, "Bao T.");
    // an invoice issued BEFORE the reward keeps its amount (Term 1 of Linh, paid by Mai)
    const before = (await invoices(sam)).find((i) => i.learnerName === "Linh N.")!;
    await sam("POST", `/v1/growth/leads/${bao.id}/confirm`, {});
    expect((await invoices(sam)).find((i) => i.id === before.id)!.creditAppliedVnd).toBe(0);
    expect(((await (await as(MAI))("GET", "/v1/me/billing")).json() as MyBilling).walletVnd).toBe(
      483_000,
    );
    await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" });
    const term2 = (await invoices(sam)).filter((i) =>
      i.lines.some((l) => l.description.includes("Term 2")),
    );
    const linh = term2.find((i) => i.learnerName === "Linh N.")!;
    expect(linh).toMatchObject({
      payerName: "Mai (Guardian)",
      subtotalVnd: 6_900_000,
      creditAppliedVnd: 483_000,
      totalVnd: 6_417_000,
      balanceVnd: 6_417_000,
    });
    expect(term2.find((i) => i.learnerName === "Minh T.")!.creditAppliedVnd).toBe(0);
    const me = (await (await as(MAI))("GET", "/v1/me/billing")).json() as MyBilling;
    expect(me.walletVnd).toBe(0);
    expect(me.invoices.find((i) => i.id === linh.id)!.totalVnd).toBe(6_417_000);
    const w = (await mine(await as(MAI))).wallet;
    expect(w.entries.map((e) => [e.kind, e.amountVnd])).toEqual([
      ["applied", -483_000],
      ["credit", 483_000],
    ]);
    expect(w.entries[0].note).toBe(`Applied to ${linh.no} (Linh N.)`);
    expect((await sam("GET", "/v1/billing/receivables")).json().creditAppliedVnd).toBe(483_000);
    // void → back to the wallet; regenerate → applied again
    await sam("POST", `/v1/billing/invoices/${linh.id}/void`, { reason: "Wrong course" });
    expect((await mine(await as(MAI))).wallet.balanceVnd).toBe(483_000);
    await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" });
    const again = (await invoices(sam)).find(
      (i) =>
        i.learnerName === "Linh N." &&
        i.status !== "void" &&
        i.lines.some((l) => l.description.includes("Term 2")),
    )!;
    expect(again.creditAppliedVnd).toBe(483_000);
    expect((await mine(await as(MAI))).wallet.balanceVnd).toBe(0);
    // payments stop at what is owed after the credit
    const over = await sam("POST", `/v1/billing/invoices/${again.id}/payments`, {
      amountVnd: 6_900_000,
      method: "cash",
    });
    expect(over.statusCode).toBe(422);
    await sam("POST", `/v1/billing/invoices/${again.id}/payments`, {
      amountVnd: 6_417_000,
      method: "cash",
    });
    expect((await invoices(sam)).find((i) => i.id === again.id)!.status).toBe("paid");
  });

  it("credit larger than the invoice covers it in full; the rest waits for the next one", async () => {
    const sam = await as(SAM);
    await ownerQuery(
      `insert into wallet_entry (org_id, id, principal_id, at, kind, amount_vnd, note)
       values ($1, 'W-90', 'iios-principal-guardian-1', now(), 'credit', 10000000, 'Big credit (test)')`,
      [NOVA],
    );
    await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" });
    const linh = (await invoices(sam)).find(
      (i) => i.learnerName === "Linh N." && i.lines.some((l) => l.description.includes("Term 2")),
    )!;
    expect(linh).toMatchObject({
      creditAppliedVnd: 6_900_000,
      totalVnd: 0,
      balanceVnd: 0,
      status: "paid",
    });
    expect((await mine(await as(MAI))).wallet.balanceVnd).toBe(3_100_000);
  });

  it("rewards and wallet entries never change; a code is added only within the organization", async () => {
    await (
      await as(SAM)
    )("POST", `/v1/growth/leads/${(await ref(await as(SAM), "Bao T.")).id}/confirm`, {});
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    try {
      for (const q of [
        "update referral_reward set reward_vnd = 1",
        "update wallet_entry set amount_vnd = 1",
        "delete from wallet_entry",
        "update invoice set credit_applied_vnd = 0",
        "update referral_code set org_id = org_id",
      ])
        await expect(app.query(q)).rejects.toThrow(/permission denied/);
      await app.query("begin");
      await app.query("select set_config('app.org_id', $1, true)", [LUMEN]);
      await expect(
        app.query(
          "insert into referral_code (code, org_id, principal_id) values ('OGCAAAAAA', $1, 'x')",
          [NOVA],
        ),
      ).rejects.toThrow(/row-level security/);
      await app.query("rollback");
    } finally {
      await app.end();
    }
    await expect(ownerQuery("update referral_reward set reward_vnd = 1")).rejects.toThrow(
      /immutable/,
    );
    await expect(ownerQuery("update wallet_entry set note = 'changed'")).rejects.toThrow(
      /immutable/,
    );
    await expect(
      ownerQuery("update invoice set credit_applied_vnd = subtotal_vnd + 1 where id = 'I-1'"),
    ).rejects.toThrow(/credit_applied_vnd_check/);
  });
});
