// Partner Commissions on the Platform API, part B: settlement batches (staff draft, another Org
// Admin sends — then locked — the partner pays the whole batch), partner reports previewed and
// applied one row at a time by a person, and six-month trends with their counts.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  ActivityEntry,
  BatchCandidate,
  CommissionEntry,
  PartnersOverview,
  PartnerTrend,
  ReportRow,
  SettlementBatch,
} from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { withTenant } from "./db.js";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "settle-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time
const DAY = 86_400_000;
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `stl-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("partners part B — API", () => {
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
  const batches = async (c: Call) =>
    (await c("GET", "/v1/partners/batches")).json() as SettlementBatch[];
  const candidates = async (c: Call) =>
    (await c("GET", "/v1/partners/batch-candidates")).json() as BatchCandidate[];
  const preview = async (c: Call, partnerId: string, csv: string) =>
    (await c("POST", `/v1/partners/${partnerId}/report/preview`, { csv })).json() as ReportRow[];

  it("seeds the paid batches; approved entries outside a batch are ready to batch", async () => {
    const sam = await as(SAM);
    const bs = await batches(sam);
    expect(
      bs.map((b) => [
        b.id,
        b.status,
        b.totalVnd,
        b.entries.map((e) => e.learnerDisplayName),
        b.paymentRef,
      ]),
    ).toEqual([
      ["ST-BRIDGE-01", "paid", 800_000, ["Vinh Q."], "BANK-BRIDGE-01"],
      ["ST-LOTUS-01", "paid", 2_000_000, ["Ha T.", "Long V."], "BANK-LOTUS-01"],
    ]);
    for (const b of bs) {
      expect(Date.parse(b.sentAt!)).toBeGreaterThan(Date.parse(b.createdAt));
      expect(Date.parse(b.paidAt!)).toBeGreaterThan(Date.parse(b.sentAt!));
      expect(Date.parse(b.paidAt!)).toBeLessThan(NOW);
    }
    expect(await candidates(sam)).toEqual([
      {
        partnerId: "PTN-LOTUS",
        partnerName: "Lotus English — Binh Thanh",
        cycleLabel: "Oct 2026",
        entries: 1,
        totalVnd: 1_000_000,
      },
    ]);
    expect((await entry(sam, "Ha T.")).batchId).toBe("ST-LOTUS-01");
  });

  it("staff draft; another Org Admin sends (locked, new due date); the partner pays the whole batch", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    expect(
      (
        await sam("POST", "/v1/partners/batches", {
          partnerId: "PTN-LOTUS",
          cycleLabel: "Nov 2026",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await sam("POST", "/v1/partners/batches", {
          partnerId: "PTN-LOTUS",
          cycleLabel: "Oct 2026",
        })
      ).statusCode,
    ).toBe(200);
    const draft = (await batches(sam)).find((b) => b.id === "ST-LOTUS-02")!;
    expect(draft).toMatchObject({
      status: "draft",
      cycleLabel: "Oct 2026",
      totalVnd: 1_000_000,
      createdBy: "Sam (Org Staff)",
      mine: true,
    });
    expect(await candidates(sam)).toEqual([]);
    expect((await entry(sam, "Trang N.")).batchId).toBe("ST-LOTUS-02");
    expect(
      (
        await sam("POST", "/v1/partners/batches", {
          partnerId: "PTN-LOTUS",
          cycleLabel: "Oct 2026",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await sam("POST", "/v1/partners/batches/ST-LOTUS-02/paid", { paymentRef: "BANK-1" })).json()
        .detail,
    ).toBe("send the batch first");
    expect((await sam("POST", "/v1/partners/batches/ST-LOTUS-02/send", {})).json().reason).toBe(
      "not_org_admin",
    );

    expect((await olivia("POST", "/v1/partners/batches/ST-LOTUS-02/send", {})).statusCode).toBe(
      200,
    );
    const sent = (await batches(olivia)).find((b) => b.id === "ST-LOTUS-02")!;
    expect(sent).toMatchObject({
      status: "sent",
      sentBy: "Olivia (Org Admin)",
      dueDate: new Date(NOW + 15 * DAY).toISOString(),
      overdue: false,
    });
    // the sent batch's due date replaces the approval's: Trang N. is no longer overdue
    expect(await entry(sam, "Trang N.")).toMatchObject({
      status: "approved",
      dueDate: sent.dueDate,
    });
    const o = await overview(sam);
    expect(o.signals.some((s) => s.rule === "overdue_settlement")).toBe(false);
    expect(o.partners.find((p) => p.partnerId === "PTN-LOTUS")!.overdueVnd).toBe(0);
    expect((await olivia("POST", "/v1/partners/batches/ST-LOTUS-02/send", {})).statusCode).toBe(
      409,
    );
    // after its due date the sent batch is overdue (and so is the signal)
    now = NOW + 16 * DAY;
    expect((await batches(sam)).find((b) => b.id === "ST-LOTUS-02")!.overdue).toBe(true);
    expect(
      (await overview(sam)).signals.find((s) => s.rule === "overdue_settlement")!.evidence[0],
    ).toMatch(/batch ST-LOTUS-02/);

    expect(
      (await sam("POST", "/v1/partners/batches/ST-LOTUS-02/paid", { paymentRef: "no" })).statusCode,
    ).toBe(422);
    expect(
      (await sam("POST", "/v1/partners/batches/ST-LOTUS-02/paid", { paymentRef: "BANK-7788" }))
        .statusCode,
    ).toBe(200);
    expect((await batches(sam)).find((b) => b.id === "ST-LOTUS-02")).toMatchObject({
      status: "paid",
      paidBy: "Sam (Org Staff)",
      paymentRef: "BANK-7788",
    });
    expect(await entry(sam, "Trang N.")).toMatchObject({
      status: "paid",
      settledBatchId: "ST-LOTUS-02",
    });
    expect((await overview(sam)).kpis).toMatchObject({
      receivedVnd: 3_800_000,
      awaitingPaymentVnd: 0,
    });
    expect(
      (await sam("POST", "/v1/partners/batches/ST-LOTUS-02/paid", { paymentRef: "BANK-7788" }))
        .statusCode,
    ).toBe(409);
    const log = (await sam("GET", "/v1/partners/activity")).json() as ActivityEntry[];
    expect(log.map((a) => a.action).slice(0, 3)).toEqual([
      "batch paid",
      "batch sent",
      "batch drafted",
    ]);
  });

  it("never send your own batch; cancel needs a reason; a sent batch is cancelled by an Org Admin only", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    // Olivia approves Quan B. (Nov) and drafts that batch herself: she cannot send it
    const quan = await entry(sam, "Quan B.");
    await olivia("POST", `/v1/partners/entries/${quan.id}/approve`, {});
    await olivia("POST", "/v1/partners/batches", {
      partnerId: "PTN-LOTUS",
      cycleLabel: "Nov 2026",
    });
    const own = await olivia("POST", "/v1/partners/batches/ST-LOTUS-02/send", {});
    expect([own.statusCode, own.json().reason]).toEqual([403, "own_step"]);
    // a draft: staff may cancel it, with a reason; the entry is ready to batch again
    expect(
      (await sam("POST", "/v1/partners/batches/ST-LOTUS-02/cancel", { reason: "x" })).statusCode,
    ).toBe(422);
    expect(
      (await sam("POST", "/v1/partners/batches/ST-LOTUS-02/cancel", { reason: "Wrong cycle" }))
        .statusCode,
    ).toBe(200);
    expect((await batches(sam)).find((b) => b.id === "ST-LOTUS-02")).toMatchObject({
      status: "cancelled",
      cancelReason: "Wrong cycle",
    });
    expect((await candidates(sam)).map((c) => c.cycleLabel).sort()).toEqual([
      "Nov 2026",
      "Oct 2026",
    ]);
    expect((await entry(sam, "Quan B.")).batchId).toBeNull();
    // a sent batch: staff cannot cancel it, an Org Admin can
    await sam("POST", "/v1/partners/batches", { partnerId: "PTN-LOTUS", cycleLabel: "Oct 2026" });
    await olivia("POST", "/v1/partners/batches/ST-LOTUS-03/send", {});
    const staff = await sam("POST", "/v1/partners/batches/ST-LOTUS-03/cancel", {
      reason: "Partner disputes it",
    });
    expect([staff.statusCode, staff.json().reason]).toEqual([403, "not_org_admin"]);
    expect(
      (
        await olivia("POST", "/v1/partners/batches/ST-LOTUS-03/cancel", {
          reason: "Partner disputes it",
        })
      ).statusCode,
    ).toBe(200);
    expect(await entry(sam, "Trang N.")).toMatchObject({
      status: "approved",
      batchId: null,
      dueDate: expect.stringMatching(/^2026-11-08/),
    });
    // a paid batch is final
    expect(
      (await olivia("POST", "/v1/partners/batches/ST-LOTUS-01/cancel", { reason: "Mistake here" }))
        .statusCode,
    ).toBe(409);
  });

  it("partner report: preview classifies every row and changes nothing", async () => {
    const sam = await as(SAM);
    const before = await entries(sam);
    const rows = await preview(
      sam,
      "PTN-LOTUS",
      [
        "lead,status,date,reason",
        "LR-1004,enrolled,2026-11-20",
        "LR-1005,enrolled,2026-11-01",
        "LR-1001,enrolled,2026-11-02",
        "LR-9999,enrolled,2026-11-20",
        "LR-1006,rejected,,changed mind",
        "LR-1005,rejected,,no",
        "LR-1005,enrolled,2026-12-01",
        "LR-1011,enrolled,2026-11-20",
        "bogus",
      ].join("\n"),
    );
    expect(rows.map((r) => [r.line, r.match])).toEqual([
      [2, "applicable"],
      [3, "conflict"],
      [4, "already"],
      [5, "not_found"],
      [6, "conflict"],
      [7, "invalid"],
      [8, "conflict"],
      [9, "not_found"], // a Sao Mai code is not Lotus's
      [10, "invalid"],
    ]);
    expect(rows[0]).toMatchObject({
      learnerDisplayName: "Mai L.",
      explanation: "referred → enrolled on 2026-11-20",
    });
    expect(rows[1].explanation).toBe("enrolled 2026-11-01, before the referral on 2026-11-11");
    expect(rows[6].explanation).toBe("enrolment date 2026-12-01 is in the future");
    expect(await entries(sam)).toEqual(before);
    expect(
      (await sam("POST", "/v1/partners/PTN-NOPE/report/preview", { csv: "x" })).statusCode,
    ).toBe(404);
  });

  it("partner report: a person applies one applicable row at a time, re-checked when applied", async () => {
    const sam = await as(SAM);
    const r = await sam("POST", "/v1/partners/PTN-LOTUS/report/apply", {
      leadRefCode: "LR-1004",
      reported: "enrolled",
      date: "2026-11-20",
    });
    expect(r.statusCode).toBe(200);
    // the partner's date (09:00 center time), under the active rule; the 4th of November → tier 2
    expect(await entry(sam, "Mai L.")).toMatchObject({
      status: "enrolled",
      enrolledAt: "2026-11-20T02:00:00.000Z",
      appliedRuleVersion: 1,
      amountVnd: 2_000_000,
    });
    const again = await sam("POST", "/v1/partners/PTN-LOTUS/report/apply", {
      leadRefCode: "LR-1004",
      reported: "enrolled",
      date: "2026-11-20",
    });
    expect([again.statusCode, again.json().detail]).toEqual([
      409,
      "already enrolled in the ledger",
    ]);
    const bad = await sam("POST", "/v1/partners/PTN-LOTUS/report/apply", {
      leadRefCode: "LR-1005",
      reported: "rejected",
      reason: "no",
    });
    expect(bad.statusCode).toBe(422);
    expect(
      (
        await sam("POST", "/v1/partners/PTN-LOTUS/report/apply", {
          leadRefCode: "LR-1005",
          reported: "rejected",
          reason: "Chose another school",
        })
      ).statusCode,
    ).toBe(200);
    expect(await entry(sam, "Son K.")).toMatchObject({
      status: "rejected",
      rejectReason: "Chose another school",
    });
    // Sao Mai's window for Tuan M. ends 28/11: a report applied on 03/12 for 30/11 is a conflict
    now = NOW + 10 * DAY;
    const late = await sam("POST", "/v1/partners/PTN-SAOMAI/report/apply", {
      leadRefCode: "LR-1011",
      reported: "enrolled",
      date: "2026-11-30",
    });
    expect([late.statusCode, late.json().detail]).toEqual([
      409,
      expect.stringMatching(/after the attribution window ended on 28\/11\/2026/),
    ]);
    const log = (await sam("GET", "/v1/partners/activity")).json() as ActivityEntry[];
    expect(log.map((a) => a.action)).toEqual([
      "report applied: rejected",
      "report applied: enrolled",
    ]);
  });

  it("trends: six months by referral month, every rate with its counts", async () => {
    const t6 = (await (await as(SAM))("GET", "/v1/partners/trends")).json() as PartnerTrend[];
    const lotus = t6.find((p) => p.partnerId === "PTN-LOTUS")!;
    expect(lotus.months.map((m) => m.month)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    const by = (p: PartnerTrend, m: string) => p.months.find((x) => x.month === m)!;
    expect(by(lotus, "2026-09")).toMatchObject({
      referred: 3,
      enrolled: 3,
      rejected: 0,
      open: 0,
      conversion: { n: 3, d: 3, pct: 100 },
      medianDaysToEnrol: 9,
    });
    expect(by(lotus, "2026-11")).toMatchObject({
      referred: 2,
      enrolled: 0,
      open: 2,
      conversion: { n: 0, d: 0, pct: null },
      medianDaysToEnrol: null,
    });
    const saomai = t6.find((p) => p.partnerId === "PTN-SAOMAI")!;
    expect(by(saomai, "2026-10")).toMatchObject({
      referred: 3,
      enrolled: 2,
      open: 1,
      conversion: { n: 2, d: 2, pct: 100 },
    });
    expect(by(saomai, "2026-11")).toMatchObject({
      referred: 2,
      rejected: 2,
      conversion: { n: 0, d: 2, pct: 0 },
    });
    for (const p of t6)
      for (const m of p.months) expect(m.referred).toBe(m.enrolled + m.rejected + m.open);
  });

  it("access and integrity: partners:manage only; tenants isolated; batch membership is append-only", async () => {
    state.attachments.set(SAM, "policy-front-desk-d1");
    const fd = await as(SAM);
    expect((await fd("GET", "/v1/partners/batches")).statusCode).toBe(403);
    expect(
      (
        await fd("POST", "/v1/partners/PTN-LOTUS/report/preview", {
          csv: "LR-1004,enrolled,2026-11-20",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await fd("POST", "/v1/partners/batches", { partnerId: "PTN-LOTUS", cycleLabel: "Oct 2026" }))
        .statusCode,
    ).toBe(403);
    const lumen = await as(LUMEN_STAFF, LUMEN);
    expect(await batches(lumen)).toEqual([]);
    expect(
      (await lumen("POST", "/v1/partners/batches/ST-LOTUS-01/cancel", { reason: "Not ours" }))
        .statusCode,
    ).toBe(404);
    const scope = { orgId: NOVA, principalId: SAM, requestId: "x" };
    await expect(
      withTenant(t.app, scope, (tx) => tx.deleteFrom("settlement_batch_entry").execute()),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) =>
        tx.updateTable("settlement_batch").set({ created_by: SAM }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
