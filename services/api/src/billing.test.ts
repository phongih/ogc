// Billing on the Platform API: maker-checker fee plans, idempotent invoicing, payments, voiding,
// receivables, a lead's first invoice (→ offer → enrolled), center scope, and the payer's own view.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FeeLine, Invoice, Lead, MyBilling, Payment, Receivables } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { withTenant } from "./db.js";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "billing-test-secret-0123456789abc";
const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time; Term 1 ends 30/11
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const TARA = "iios-principal-teacher-1";
const MAI = "iios-principal-guardian-1";
const LINH = "iios-principal-learner-1";
const MINH = "iios-principal-learner-2";
const LUMEN_STAFF = "iios-principal-staff-org2";
const YEAR = "2026-2027";
let seq = 0;
const key = () => `bill-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("billing — API", () => {
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
  beforeEach(async () => {
    await api?.close();
    await t?.drop();
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
    state.attachments.clear();
    api = buildApi({
      db: t.app,
      iios: httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
      now: () => NOW,
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
  const inv = async (c: Call, learner: string) =>
    (await invoices(c)).find((i) => i.learnerName === learner)!;
  const lines = async (c: Call) =>
    (await c("GET", `/v1/billing/fee-lines?year=${YEAR}`)).json() as FeeLine[];
  const leadOf = async (c: Call, name: string) =>
    ((await c("GET", "/v1/admissions/leads")).json() as Lead[]).find(
      (l) => l.learnerName === name,
    )!;
  const draft = (over: Record<string, unknown> = {}) => ({
    year: YEAR,
    courseCode: "ENG-B1",
    centerId: null,
    kind: "materials",
    period: "Term 2",
    from: "2026-12-01",
    to: "2027-02-28",
    dueDate: "2026-12-10",
    amountVnd: 500_000,
    ...over,
  });

  it("seeds the demo's fee plan and Term 1 invoices; receivables age what is still owed", async () => {
    const sam = await as(SAM);
    const ls = await lines(sam);
    expect(ls).toHaveLength(13);
    expect(ls[0]).toMatchObject({
      status: "pending",
      courseCode: "ENG-A2",
      kind: "materials",
      period: "Term 2",
      amountVnd: 450_000,
      mine: true,
    });
    expect(ls.filter((l) => l.status === "approved")).toHaveLength(12);
    expect((await sam("GET", "/v1/billing/years")).json()).toEqual(["2026-2027", "2027-2028"]);
    const periods = (await sam("GET", "/v1/billing/periods")).json() as {
      period: string;
      current: boolean;
    }[];
    expect(periods.map((p) => p.period)).toEqual(["Term 1", "Term 2", "Term 3", "Summer"]);
    expect(periods.find((p) => p.current)?.period).toBe("Term 1");

    const all = await invoices(sam);
    expect(all).toHaveLength(8); // 7 Term 1 + Bao T.'s first invoice (Growth seed)
    expect(all.map((i) => i.no)).toEqual([8, 7, 6, 5, 4, 3, 2, 1].map((n) => `INV-2026-000${n}`));
    expect(all[0]).toMatchObject({ learnerName: "Bao T.", status: "paid", subtotalVnd: 6_900_000 });
    expect(all.find((i) => i.learnerName === "Linh N.")).toMatchObject({
      payerName: "Mai (Guardian)",
      status: "paid",
    });
    expect(all.find((i) => i.learnerName === "Minh T.")).toMatchObject({
      payerName: "Minh T.",
      status: "paid",
    });
    expect(all.find((i) => i.learnerName === "An P.")).toMatchObject({
      payerName: null,
      status: "partially_paid",
      balanceVnd: 3_900_000,
    });
    const huy = all.find((i) => i.learnerName === "Huy D.")!;
    expect(huy).toMatchObject({
      status: "issued",
      dueDate: "2026-09-15",
      daysOverdue: 69,
      balanceVnd: 8_400_000,
    });
    expect(huy.lines).toEqual([
      {
        feeLineId: expect.any(String),
        description: "ENG-B1 · Tuition · Term 1 2026-2027",
        amountVnd: 8_400_000,
      },
    ]);

    const r = (await sam("GET", "/v1/billing/receivables")).json() as Receivables;
    expect(r).toMatchObject({
      outstandingVnd: 19_200_000,
      overdueVnd: 19_200_000,
      collectedVnd: 39_000_000, // incl. Bao T.'s first invoice
      creditAppliedVnd: 0,
    });
    expect(r.overdue.map((i) => i.learnerName).sort()).toEqual(["An P.", "Huy D.", "Vy H."]);
    expect(r.byCenter.map((c) => [c.centerName, c.over60Vnd])).toEqual([
      ["Nova English — District 1", 10_800_000],
      ["Nova English — Thu Duc", 8_400_000],
    ]);
    const pays = (await sam("GET", "/v1/billing/payments")).json() as Payment[];
    expect(pays).toHaveLength(6);
    expect(pays.reduce((s, p) => s + p.amountVnd, 0)).toBe(39_000_000);
  });

  it("maker-checker: staff propose; another Org Admin decides; duplicates and own proposals refused", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    const p = await sam("POST", "/v1/billing/fee-lines", draft());
    expect(p.statusCode).toBe(200);
    const id = p.json().id as string;
    expect((await lines(sam)).find((l) => l.id === id)).toMatchObject({
      status: "pending",
      proposedBy: "Sam (Org Staff)",
      mine: true,
    });
    expect((await sam("POST", "/v1/billing/fee-lines", draft())).json().detail).toMatch(
      /already exists/,
    );
    for (const [over, detail] of [
      [{ year: "2026-2028" }, /school year/],
      [{ courseCode: "ENG-Z9" }, /unknown course/],
      [{ dueDate: "2027-03-01" }, /after the period ends/],
      [{ from: "2027-03-01" }, /ends before it starts/],
      [{ amountVnd: 999 }, /1,000–500,000,000/],
      [{ amountVnd: 1.5 }, /1,000–500,000,000/],
      [{ kind: "fines" }, /fee kind/],
    ] as const)
      expect(
        (await sam("POST", "/v1/billing/fee-lines", draft(over))).json().detail,
        JSON.stringify(over),
      ).toMatch(detail);

    const a = await sam("POST", `/v1/billing/fee-lines/${id}/approve`, {});
    expect([a.statusCode, a.json().reason]).toEqual([403, "not_org_admin"]);
    const own = await olivia("POST", "/v1/billing/fee-lines", draft({ courseCode: "IELTS-B2" }));
    const ownApprove = await olivia("POST", `/v1/billing/fee-lines/${own.json().id}/approve`, {});
    expect([ownApprove.statusCode, ownApprove.json().reason]).toEqual([403, "own_proposal"]);
    expect((await olivia("POST", `/v1/billing/fee-lines/${id}/approve`, {})).statusCode).toBe(200);
    const after = (await lines(olivia)).find((l) => l.id === id)!;
    expect(after).toMatchObject({
      status: "approved",
      decidedBy: "Olivia (Org Admin)",
      mine: false,
    });
    expect((await olivia("POST", `/v1/billing/fee-lines/${id}/approve`, {})).statusCode).toBe(409);

    // reject / retire need a reason and the right status
    expect(
      (await olivia("POST", `/v1/billing/fee-lines/${own.json().id}/reject`, { note: "no" }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await olivia("POST", `/v1/billing/fee-lines/${own.json().id}/reject`, {
          note: "Not this term",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await olivia("POST", `/v1/billing/fee-lines/${id}/reject`, { note: "Not this term" }))
        .statusCode,
    ).toBe(409);
    expect(
      (await olivia("POST", `/v1/billing/fee-lines/${id}/retire`, { note: "Replaced" })).statusCode,
    ).toBe(200);
    expect((await lines(olivia)).find((l) => l.id === id)).toMatchObject({
      status: "retired",
      note: "Replaced",
    });
    // a retired line no longer blocks a new proposal
    expect((await sam("POST", "/v1/billing/fee-lines", draft())).statusCode).toBe(200);
  });

  it("generating is idempotent: one invoice per learner per fee line, ever", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    const pending = (await lines(olivia)).find((l) => l.status === "pending")!;
    await olivia("POST", `/v1/billing/fee-lines/${pending.id}/approve`, {});
    const g = await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" });
    expect(g.json()).toEqual({ ok: true, created: 7, existing: 0, skippedNoLine: [] });
    const linh = (await invoices(sam)).filter((i) => i.learnerName === "Linh N.")[0];
    expect(linh).toMatchObject({
      no: "INV-2026-0009",
      subtotalVnd: 7_350_000,
      dueDate: "2026-12-10",
      payerName: "Mai (Guardian)",
    });
    expect(linh.lines.map((l) => l.description).sort()).toEqual([
      "ENG-A2 · Materials · Term 2 2026-2027",
      "ENG-A2 · Tuition · Term 2 2026-2027",
    ]);
    expect(linh.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(7_350_000);
    const again = await sam("POST", "/v1/billing/invoices/generate", {
      year: YEAR,
      period: "Term 2",
    });
    expect(again.json()).toEqual({ ok: true, created: 0, existing: 7, skippedNoLine: [] });
    expect(await invoices(sam)).toHaveLength(15);
    // a period without a tuition line is reported, not invoiced
    const none = await sam("POST", "/v1/billing/invoices/generate", {
      year: "2027-2028",
      period: "Term 1",
    });
    expect(none.json().created).toBe(0);
    expect(none.json().skippedNoLine).toEqual([
      "ENG-A2 · Nova English — District 1",
      "ENG-B1 · Nova English — Thu Duc",
    ]);
    // a voided invoice frees its lines for a new one
    const vy = (await invoices(sam)).find(
      (i) => i.learnerName === "Vy H." && i.lines[0].description.includes("Term 2"),
    )!;
    expect(
      (await sam("POST", `/v1/billing/invoices/${vy.id}/void`, { reason: "Wrong course" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" })).json(),
    ).toMatchObject({ created: 1, existing: 6 });
  });

  it("payments: within the balance, receipts numbered, paid invoices closed; void only when unpaid", async () => {
    const sam = await as(SAM);
    const an = await inv(sam, "An P.");
    for (const [amountVnd, method] of [
      [3_900_001, "cash"],
      [0, "cash"],
      [1_000, "cheque"],
    ] as const)
      expect(
        (await sam("POST", `/v1/billing/invoices/${an.id}/payments`, { amountVnd, method }))
          .statusCode,
      ).toBe(422);
    const part = await sam("POST", `/v1/billing/invoices/${an.id}/payments`, {
      amountVnd: 900_000,
      method: "cash",
    });
    expect(part.json()).toEqual({ ok: true, receiptNo: "RC-2026-0007" });
    expect(await inv(sam, "An P.")).toMatchObject({
      status: "partially_paid",
      paidVnd: 3_900_000,
      balanceVnd: 3_000_000,
    });
    await sam("POST", `/v1/billing/invoices/${an.id}/payments`, {
      amountVnd: 3_000_000,
      method: "card",
    });
    const paid = await inv(sam, "An P.");
    expect(paid).toMatchObject({ status: "paid", balanceVnd: 0, daysOverdue: 0 });
    expect(paid.payments.map((p) => [p.receiptNo, p.recordedBy])).toEqual([
      ["RC-2026-0003", "Sam (Org Staff)"],
      ["RC-2026-0007", "Sam (Org Staff)"],
      ["RC-2026-0008", "Sam (Org Staff)"],
    ]);
    expect(
      (
        await sam("POST", `/v1/billing/invoices/${an.id}/payments`, {
          amountVnd: 1_000,
          method: "cash",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await sam("POST", `/v1/billing/invoices/${an.id}/void`, { reason: "Wrong" })).json().detail,
    ).toMatch(/payments recorded/);
    const huy = await inv(sam, "Huy D.");
    expect(
      (await sam("POST", `/v1/billing/invoices/${huy.id}/void`, { reason: "x" })).statusCode,
    ).toBe(422);
    expect(
      (await sam("POST", `/v1/billing/invoices/${huy.id}/void`, { reason: "Left the center" }))
        .statusCode,
    ).toBe(200);
    expect(await inv(sam, "Huy D.")).toMatchObject({
      status: "void",
      balanceVnd: 0,
      daysOverdue: 0,
      voidReason: "Left the center",
    });
    expect(
      (
        await sam("POST", `/v1/billing/invoices/${huy.id}/payments`, {
          amountVnd: 1_000,
          method: "cash",
        })
      ).statusCode,
    ).toBe(409);
    const r = (await sam("GET", "/v1/billing/receivables")).json() as Receivables;
    expect(r).toMatchObject({ outstandingVnd: 6_900_000, collectedVnd: 42_900_000 });
  });

  it("a regenerated invoice is never due before 7 days after it is issued", async () => {
    const sam = await as(SAM);
    const huy = await inv(sam, "Huy D.");
    await sam("POST", `/v1/billing/invoices/${huy.id}/void`, { reason: "Re-issue" });
    const g = await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 1" });
    expect(g.json()).toMatchObject({ created: 1, existing: 6 });
    const again = (await invoices(sam)).find(
      (i) => i.learnerName === "Huy D." && i.status !== "void",
    )!;
    // Term 1 was due 15/09; issued 23/11 → due 30/11, not "69 days overdue" at once
    expect(again).toMatchObject({ no: "INV-2026-0009", dueDate: "2026-11-30", daysOverdue: 0 });
  });

  it("a center's own line beats the all-centers line; a learner in two classes of one course is billed once", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    const c = new pg.Client({ connectionString: t.ownerUrl });
    await c.connect();
    try {
      await c.query("select set_config('app.org_id', $1, false)", [NOVA]);
      // Linh also joins A2 Evening (same course as A2 Morning)
      await c.query("insert into roster (org_id, class_id, learner_id) values ($1, $2, $3)", [
        NOVA,
        "00000000-0000-4000-8000-0000000000k3",
        "00000000-0000-4000-8000-00000000L001",
      ]);
    } finally {
      await c.end();
    }
    const d1 = "00000000-0000-4000-8000-000000000c01";
    const p = await sam(
      "POST",
      "/v1/billing/fee-lines",
      draft({ courseCode: "ENG-A2", kind: "tuition", centerId: d1, amountVnd: 7_200_000 }),
    );
    expect(
      (await olivia("POST", `/v1/billing/fee-lines/${p.json().id}/approve`, {})).statusCode,
    ).toBe(200);
    const g = await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" });
    expect(g.json()).toMatchObject({ created: 7, existing: 0 });
    const term2 = (await invoices(sam)).filter((i) =>
      i.lines.some((l) => l.description.includes("Term 2")),
    );
    expect(term2.filter((i) => i.learnerName === "Linh N.")).toHaveLength(1);
    expect(term2.find((i) => i.learnerName === "Linh N.")!.subtotalVnd).toBe(7_200_000);
    expect(term2.find((i) => i.learnerName === "Huy D.")!.subtotalVnd).toBe(8_400_000);
  });

  it("an approved line is never doubled; a lead is never first-invoiced twice (even if the data says so)", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    const scope = { orgId: NOVA, principalId: SAM, requestId: "x" };
    // A pending line that duplicates an approved one (e.g. written before a policy change)
    await withTenant(t.app, scope, (tx) =>
      tx
        .insertInto("fee_line")
        .values({
          org_id: NOVA,
          id: "FL-99",
          year: YEAR,
          course_code: "ENG-B1",
          center_id: null,
          kind: "tuition",
          period: "Term 2",
          from_date: "2026-12-01",
          to_date: "2027-02-28",
          due_date: "2026-12-10",
          amount_vnd: 9_000_000,
          status: "pending",
          proposed_by: SAM,
          proposed_by_name: "Sam (Org Staff)",
          proposed_at: new Date(NOW),
          decided_by_name: null,
          decided_at: null,
          note: null,
        })
        .execute(),
    );
    const a = await olivia("POST", "/v1/billing/fee-lines/FL-99/approve", {});
    expect([a.statusCode, a.json().detail]).toEqual([
      409,
      "an approved line already covers this — retire it first",
    ]);
    // A placement lead that already carries an invoice number
    const yen = await leadOf(sam, "Yen T.");
    await withTenant(t.app, scope, (tx) =>
      tx
        .updateTable("lead")
        .set({ invoice_no: "INV-2026-0042" })
        .where("id", "=", yen.id)
        .execute(),
    );
    const r = await sam("POST", "/v1/billing/invoices/first", { leadId: yen.id });
    expect([r.statusCode, r.json().detail]).toEqual([409, "already invoiced: INV-2026-0042"]);
  });

  it("a lead's first invoice: placement → offer; paid in full → enrolled; voided → placement", async () => {
    const sam = await as(SAM);
    const hoa = await leadOf(sam, "Hoa P.");
    const early = await sam("POST", "/v1/billing/invoices/first", { leadId: hoa.id });
    expect([early.statusCode, early.json().detail]).toEqual([
      409,
      "record the placement test in Admissions first",
    ]);

    const yen = await leadOf(sam, "Yen T."); // ENG-A2, District 1, placement
    const r = await sam("POST", "/v1/billing/invoices/first", { leadId: yen.id });
    expect(r.json()).toEqual({ ok: true, invoiceNo: "INV-2026-0009" });
    // Term 1 ends within 30 days → Term 2's tuition, due 10/12 (not before 7 days after issue)
    const first = await inv(sam, "Yen T.");
    expect(first).toMatchObject({
      billTo: { kind: "lead", leadId: yen.id },
      subtotalVnd: 6_900_000,
      dueDate: "2026-12-10",
      payerName: null,
    });
    expect(first.lines.map((l) => l.description)).toEqual(["ENG-A2 · Tuition · Term 2 2026-2027"]);
    expect(await leadOf(sam, "Yen T.")).toMatchObject({
      stage: "offer",
      invoiceNo: "INV-2026-0009",
    });
    expect((await sam("POST", "/v1/billing/invoices/first", { leadId: yen.id })).statusCode).toBe(
      409,
    );
    // Admissions cannot move it by hand while the invoice is open
    expect(
      (
        await sam("PUT", `/v1/admissions/leads/${yen.id}/stage`, {
          stage: "lost",
          reason: "Changed mind",
        })
      ).statusCode,
    ).toBe(409);

    await sam("POST", `/v1/billing/invoices/${first.id}/payments`, {
      amountVnd: 2_000_000,
      method: "cash",
    });
    expect((await leadOf(sam, "Yen T.")).stage).toBe("offer");
    await sam("POST", `/v1/billing/invoices/${first.id}/payments`, {
      amountVnd: 4_900_000,
      method: "bank_transfer",
    });
    const enrolled = await leadOf(sam, "Yen T.");
    expect(enrolled).toMatchObject({ stage: "enrolled", firstPaymentVnd: 6_900_000 });
    expect(enrolled.stageHistory.slice(-2).map((h) => [h.stage, h.by])).toEqual([
      ["offer", "Sam (Org Staff)"],
      ["enrolled", "Sam (Org Staff)"],
    ]);

    const son = await leadOf(sam, "Son V."); // IELTS-B2, placement
    await sam("POST", "/v1/billing/invoices/first", { leadId: son.id });
    const sonInv = await inv(sam, "Son V.");
    expect(sonInv.subtotalVnd).toBe(12_000_000);
    await sam("POST", `/v1/billing/invoices/${sonInv.id}/void`, { reason: "Issued by mistake" });
    expect(await leadOf(sam, "Son V.")).toMatchObject({ stage: "placement", invoiceNo: null });
    // no learner was created for a lead (owner 23/11)
    const learners = await withTenant(
      t.app,
      { orgId: NOVA, principalId: SAM, requestId: "x" },
      (tx) => tx.selectFrom("learner").select("display_name").execute(),
    );
    expect(learners.map((l) => l.display_name)).not.toContain("Yen T.");
  });

  it("no approved fee line → the first invoice is refused, the lead stays at placement", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    for (const l of (await lines(olivia)).filter(
      (x) => x.courseCode === "IELTS-B2" && x.status === "approved",
    ))
      await olivia("POST", `/v1/billing/fee-lines/${l.id}/retire`, { note: "Course paused" });
    const son = await leadOf(sam, "Son V.");
    const r = await sam("POST", "/v1/billing/invoices/first", { leadId: son.id });
    expect([r.statusCode, r.json().reason]).toEqual([409, "no_fee_line"]);
    expect(await leadOf(sam, "Son V.")).toMatchObject({ stage: "placement", invoiceNo: null });
  });

  it("center scope: a District 1 front desk bills District 1 only", async () => {
    state.attachments.set(SAM, "policy-front-desk-d1");
    const sam = await as(SAM);
    const mine = await invoices(sam);
    expect(mine.map((i) => i.learnerName).sort()).toEqual([
      "An P.",
      "Bao T.",
      "Khoa L.",
      "Linh N.",
      "Minh T.",
      "Vy H.",
    ]);
    expect(
      ((await sam("GET", "/v1/billing/receivables")).json() as Receivables).outstandingVnd,
    ).toBe(10_800_000);
    const olivia = await as(OLIVIA);
    const huy = await inv(olivia, "Huy D.");
    const pay = await sam("POST", `/v1/billing/invoices/${huy.id}/payments`, {
      amountVnd: 1_000,
      method: "cash",
    });
    expect([pay.statusCode, pay.json().reason]).toEqual([403, "access_policy"]);
    expect(
      (await sam("POST", `/v1/billing/invoices/${huy.id}/void`, { reason: "Left" })).statusCode,
    ).toBe(403);
    expect((await sam("POST", "/v1/billing/fee-lines", draft())).statusCode).toBe(403); // all centers
    const g = await sam("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" });
    expect(g.json()).toMatchObject({ created: 5 });
    expect((await invoices(olivia)).filter((i) => i.learnerName === "Huy D.")).toHaveLength(1);
    const lan = await leadOf(olivia, "Lan H."); // Thu Duc
    expect((await sam("POST", "/v1/billing/invoices/first", { leadId: lan.id })).statusCode).toBe(
      403,
    );
  });

  it("payers see their own invoices only; a minor sees none; staff-only elsewhere; tenants isolated", async () => {
    const mai = (await (await as(MAI))("GET", "/v1/me/billing")).json() as MyBilling;
    expect(mai.invoices.map((i) => [i.learnerName, i.status])).toEqual([["Linh N.", "paid"]]);
    expect(mai).toMatchObject({ outstandingVnd: 0, walletVnd: 0 });
    const minh = (await (await as(MINH))("GET", "/v1/me/billing")).json() as MyBilling;
    expect(minh.invoices.map((i) => i.learnerName)).toEqual(["Minh T."]);
    expect((await (await as(LINH))("GET", "/v1/me/billing")).statusCode).toBe(403);
    expect((await (await as(TARA))("GET", "/v1/me/billing")).statusCode).toBe(403);
    expect((await (await as(TARA))("GET", "/v1/billing/invoices")).statusCode).toBe(403);
    expect(
      (
        await (
          await as(MAI)
        )("POST", "/v1/billing/invoices/generate", { year: YEAR, period: "Term 2" })
      ).statusCode,
    ).toBe(403);
    const lumen = await as(LUMEN_STAFF, LUMEN);
    expect(await invoices(lumen)).toEqual([]);
    const huy = await inv(await as(SAM), "Huy D.");
    expect(
      (
        await lumen("POST", `/v1/billing/invoices/${huy.id}/payments`, {
          amountVnd: 1_000,
          method: "cash",
        })
      ).statusCode,
    ).toBe(404);
  });

  it("payments and invoice lines are append-only; amounts cannot be edited", async () => {
    const scope = { orgId: NOVA, principalId: SAM, requestId: "x" };
    await expect(
      withTenant(t.app, scope, (tx) => tx.updateTable("payment").set({ amount_vnd: 1 }).execute()),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) => tx.deleteFrom("payment").execute()),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) =>
        tx.updateTable("invoice").set({ subtotal_vnd: 1 }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) => tx.updateTable("fee_line").set({ amount_vnd: 1 }).execute()),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) => tx.deleteFrom("invoice_line").execute()),
    ).rejects.toThrow(/permission denied/);
  });
});
