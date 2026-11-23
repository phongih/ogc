// Admissions on the Platform API: one pipeline, an explainable score, rates that never exceed
// 100%, synthetic-only profiles, center-scoped writes (admissions:manage), and "offer"/"enrolled"
// reachable only through the Billing hooks.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AdmissionsDashboard, Lead, ScoringSettings } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { withTenant } from "./db.js";
import { attachFirstInvoice, markLeadPaid } from "./domains/admissions.js";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { D1, LUMEN, NOVA, THU_DUC, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "admissions-test-secret-0123456789";
const NOW = Date.parse("2026-11-23T05:00:00Z");
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const TARA_P = "iios-principal-teacher-1";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `adm-${Date.now()}-${++seq}-abc`;
const draft = (over: Record<string, unknown> = {}) => ({
  learnerName: "Mai Q.",
  courseCode: "ENG-A2",
  centerId: D1,
  source: "walk_in",
  channel: "zalo",
  needs: ["speaking_confidence"],
  note: "Prefers evenings",
  ...over,
});

describe.skipIf(!hasPg)("admissions — API", () => {
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
    return (method: "GET" | "PUT" | "POST", url: string, body?: unknown) =>
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
  const leads = async (call: Awaited<ReturnType<typeof as>>) =>
    (await call("GET", "/v1/admissions/leads")).json() as Lead[];
  const lead = async (call: Awaited<ReturnType<typeof as>>, name: string) =>
    (await leads(call)).find((l) => l.learnerName === name)!;

  it("lists the seeded pipeline ranked by an explainable score", async () => {
    const sam = await as(SAM);
    const all = await leads(sam);
    expect(all).toHaveLength(16); // 14 + Mai's two referrals (Growth seed)
    for (const l of all) {
      expect(l.score.parts.map((p) => p.key)).toEqual([
        "source",
        "course_fit",
        "engagement",
        "recency",
        "progress",
      ]);
      expect(l.score.parts.reduce((s, p) => s + p.points, 0)).toBe(l.score.total);
      expect(l.score.parts.reduce((s, p) => s + p.max, 0)).toBe(100);
      for (const p of l.score.parts) expect(p.why.length).toBeGreaterThan(3);
      expect(l.score.band).toBe(
        l.score.total >= 70 ? "hot" : l.score.total >= 40 ? "warm" : "cold",
      );
    }
    const totals = all.map((l) => l.score.total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
    // Hoa: walk-in (0.8 × 25 = 20), A2 has a class at D1 (20), no activities, created yesterday, new.
    const hoa = all.find((l) => l.learnerName === "Hoa P.")!;
    expect(hoa.stage).toBe("new");
    expect(hoa.score.parts.map((p) => p.points)).toEqual([20, 20, 0, 20, 0]);
    expect(hoa.score.parts[1].why).toMatch(/has a class at this center/);
    // Duc: A2 at Cau Giay where no class runs, but A2 runs elsewhere → half.
    const duc = all.find((l) => l.learnerName === "Duc A.")!;
    expect(duc.score.parts[1]).toMatchObject({
      points: 10,
      why: expect.stringMatching(/another center only/),
    });
    // History newest-last, activities newest-first.
    const nhi = all.find((l) => l.learnerName === "Nhi C.")!;
    expect(nhi.stage).toBe("lost");
    expect(nhi.stageHistory[0].stage).toBe("new");
    expect(nhi.stageHistory.at(-1)!.stage).toBe("lost");
    // No contact details in any profile.
    const texts = all.flatMap((l) => [l.learnerName, l.note, ...l.activities.map((a) => a.text)]);
    expect(texts.join(" | ")).not.toMatch(/@|\d{6,}/);
  });

  it("dashboard rates carry numerator and denominator and stay ≤ 100%", async () => {
    const sam = await as(SAM);
    const d = (await sam("GET", "/v1/admissions/dashboard")).json() as AdmissionsDashboard;
    // "Reached" is the furthest stage in a lead's history — a lost lead keeps what it got to.
    const all = await leads(sam);
    const order = ["new", "assigned", "contacted", "placement", "offer", "enrolled"];
    const furthest = (l: Lead) => Math.max(...l.stageHistory.map((h) => order.indexOf(h.stage)));
    expect(all.some((l) => l.stage === "lost" && furthest(l) >= 1)).toBe(true);
    expect(d.conversions.map((c) => c.reached)).toEqual(
      order.slice(1).map((_, i) => all.filter((l) => furthest(l) >= i + 1).length),
    );
    expect(d.total).toBe(16);
    expect(d.byStage.reduce((s, x) => s + x.count, 0)).toBe(16);
    expect(d.open + d.enrolled + d.lost).toBe(16);
    for (const c of d.conversions) {
      expect(c.reached).toBeLessThanOrEqual(c.of);
      if (c.pct !== null) expect(c.pct).toBeLessThanOrEqual(100);
    }
    // Reached counts the furthest stage ever: every lead reached "new".
    expect(d.conversions[0].of).toBe(16);
    expect(d.leadToEnrolled).toMatchObject({ reached: d.enrolled, of: 16 });
    expect(d.bands.hot + d.bands.warm + d.bands.cold).toBe(d.open);
    expect(d.bySource.reduce((s, x) => s + x.leads, 0)).toBe(16);
    expect(d.counselors.map((c) => c.name).sort()).toEqual([
      "Olivia (Org Admin)",
      "Sam (Org Staff)",
    ]);
  });

  it("adds a lead with the next ADM number; refuses contact details and unknown values", async () => {
    const sam = await as(SAM);
    const ok = await sam("POST", "/v1/admissions/leads", draft());
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true, id: "ADM-17" });
    const mai = await lead(sam, "Mai Q.");
    expect(mai).toMatchObject({
      id: "ADM-17",
      stage: "new",
      source: "walk_in",
      assignedTo: null,
      referredBy: null,
    });
    expect(mai.stageHistory).toEqual([
      { stage: "new", at: new Date(NOW).toISOString(), by: "Sam (Org Staff)" },
    ]);

    for (const [over, detail] of [
      [{ learnerName: "Mai 0903123456" }, /phone numbers/],
      [{ note: "mail mai@example.test" }, /e-mail/],
      [{ courseCode: "ENG-Z9" }, /unknown course/],
      [{ centerId: "00000000-0000-4000-8000-000000000c99" }, /unknown center/],
      [{ source: "referral" }, /unknown source/],
      [{ needs: ["visa"] }, /learning need/],
      [{ note: "x".repeat(281) }, /280/],
      [{ learnerName: "M" }, /2–60/],
    ] as const) {
      const r = await sam("POST", "/v1/admissions/leads", draft(over));
      expect(r.statusCode, JSON.stringify(over)).toBe(422);
      expect(r.json().detail).toMatch(detail);
    }
    expect(await leads(sam)).toHaveLength(17);
  });

  it("center scope: a District 1 front desk sees and acts on District 1 leads only", async () => {
    state.attachments.set(SAM, "policy-front-desk-d1");
    const sam = await as(SAM);
    const mine = await leads(sam);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((l) => l.centerId === D1)).toBe(true);
    const opts = (await sam("GET", "/v1/admissions/options")).json();
    expect(opts.centers.map((c: { id: string }) => c.id)).toEqual([D1]);
    expect(opts.courseCodes).toEqual(["ENG-A2", "ENG-B1", "IELTS-B2"]);
    const dash = (await sam("GET", "/v1/admissions/dashboard")).json() as AdmissionsDashboard;
    expect(dash.total).toBe(mine.length);

    const r = await sam("POST", "/v1/admissions/leads", draft({ centerId: THU_DUC }));
    expect(r.statusCode).toBe(403);
    expect(r.json().reason).toBe("access_policy");
    const olivia = await as(OLIVIA);
    const lan = await lead(olivia, "Lan H."); // Thu Duc
    const a = await sam("PUT", `/v1/admissions/leads/${lan.id}/assign`, { principalId: OLIVIA });
    expect(a.statusCode).toBe(403);
    expect((await lead(olivia, "Lan H.")).assignedTo).toEqual(lan.assignedTo);
    expect((await lead(olivia, "Lan H.")).stageHistory).toHaveLength(lan.stageHistory.length);
    // The center-wide settings need the policy without a center restriction.
    const s = await sam("PUT", "/v1/admissions/settings", { ...defaults(), hotAt: 75 });
    expect(s.statusCode).toBe(403);
  });

  it("assigning moves a new lead to assigned; only staff, only open leads", async () => {
    const sam = await as(SAM);
    const hoa = await lead(sam, "Hoa P.");
    expect(
      (await sam("PUT", `/v1/admissions/leads/${hoa.id}/assign`, { principalId: TARA_P }))
        .statusCode,
    ).toBe(422);
    const r = await sam("PUT", `/v1/admissions/leads/${hoa.id}/assign`, { principalId: OLIVIA });
    expect(r.statusCode).toBe(200);
    const after = await lead(sam, "Hoa P.");
    expect(after).toMatchObject({
      stage: "assigned",
      assignedTo: { principalId: OLIVIA, name: "Olivia (Org Admin)" },
    });
    expect(after.stageHistory.map((h) => h.stage)).toEqual(["new", "assigned"]);
    // Reassigning an assigned lead keeps the stage, adds no history.
    await sam("PUT", `/v1/admissions/leads/${hoa.id}/assign`, { principalId: SAM });
    const again = await lead(sam, "Hoa P.");
    expect(again.assignedTo?.principalId).toBe(SAM);
    expect(again.stageHistory).toHaveLength(2);

    const trang = await lead(sam, "Trang B."); // enrolled
    const c = await sam("PUT", `/v1/admissions/leads/${trang.id}/assign`, { principalId: SAM });
    expect(c.statusCode).toBe(409);
    expect(c.json().reason).toBe("invalid_step");
  });

  it("stages: offer and enrolled are not set by hand; lost needs a reason", async () => {
    const sam = await as(SAM);
    const tuan = await lead(sam, "Tuan K.");
    for (const stage of ["offer", "enrolled"]) {
      const r = await sam("PUT", `/v1/admissions/leads/${tuan.id}/stage`, { stage });
      expect(r.statusCode).toBe(409);
      expect(r.json().detail).toMatch(/Billing/);
    }
    expect(
      (await sam("PUT", `/v1/admissions/leads/${tuan.id}/stage`, { stage: "lost" })).statusCode,
    ).toBe(422);
    const ok = await sam("PUT", `/v1/admissions/leads/${tuan.id}/stage`, { stage: "contacted" });
    expect(ok.statusCode).toBe(200);
    const lost = await sam("PUT", `/v1/admissions/leads/${tuan.id}/stage`, {
      stage: "lost",
      reason: "Moved away",
    });
    expect(lost.statusCode).toBe(200);
    const after = await lead(sam, "Tuan K.");
    expect(after).toMatchObject({ stage: "lost", lostReason: "Moved away", stale: false });
    expect(after.stageHistory.slice(-2).map((h) => h.stage)).toEqual(["contacted", "lost"]);
    // Reopening clears the reason.
    await sam("PUT", `/v1/admissions/leads/${tuan.id}/stage`, { stage: "contacted" });
    expect((await lead(sam, "Tuan K.")).lostReason).toBeNull();

    const trang = await lead(sam, "Trang B.");
    expect(
      (
        await sam("PUT", `/v1/admissions/leads/${trang.id}/stage`, {
          stage: "lost",
          reason: "x y z",
        })
      ).statusCode,
    ).toBe(409);
    // Assigned without a counselor is refused.
    const quan = await lead(sam, "Quan T.");
    expect(
      (await sam("PUT", `/v1/admissions/leads/${quan.id}/stage`, { stage: "assigned" })).statusCode,
    ).toBe(422);
  });

  it("activities are logged newest-first, raise engagement, and refuse contact details", async () => {
    const sam = await as(SAM);
    const quan = await lead(sam, "Quan T.");
    const before = quan.score.parts.find((p) => p.key === "engagement")!.points;
    expect(
      (
        await sam("POST", `/v1/admissions/leads/${quan.id}/activities`, {
          kind: "call",
          text: "Call 0903123456",
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await sam("POST", `/v1/admissions/leads/${quan.id}/activities`, {
          kind: "fax",
          text: "Hello",
        })
      ).statusCode,
    ).toBe(422);
    await sam("POST", `/v1/admissions/leads/${quan.id}/activities`, {
      kind: "call",
      text: "First call",
    });
    await sam("POST", `/v1/admissions/leads/${quan.id}/activities`, {
      kind: "note",
      text: "Wants a trial",
    });
    const after = await lead(sam, "Quan T.");
    expect(after.activities.map((a) => a.text)).toEqual(["Wants a trial", "First call"]);
    expect(after.activities[0]).toMatchObject({ by: "Sam (Org Staff)", kind: "note" });
    expect(after.score.parts.find((p) => p.key === "engagement")!.points).toBe(before + 10);
    expect(after.firstResponseHours).not.toBeNull();
  });

  const defaults = (): ScoringSettings => ({
    max: { source: 25, course_fit: 20, engagement: 20, recency: 20, progress: 15 },
    hotAt: 70,
    warmAt: 40,
    staleDays: 7,
  });

  it("settings: validated, then applied to every score", async () => {
    const sam = await as(SAM);
    expect((await sam("GET", "/v1/admissions/settings")).json()).toEqual(defaults());
    for (const bad of [
      { ...defaults(), max: { ...defaults().max, source: 30 } }, // sums to 105
      { ...defaults(), warmAt: 70 },
      { ...defaults(), staleDays: 0 },
      { ...defaults(), max: { ...defaults().max, extra: 0 } },
    ])
      expect(
        (await sam("PUT", "/v1/admissions/settings", bad)).statusCode,
        JSON.stringify(bad),
      ).toBe(422);
    const next = {
      max: { source: 0, course_fit: 25, engagement: 25, recency: 25, progress: 25 },
      hotAt: 60,
      warmAt: 30,
      staleDays: 3,
    };
    expect((await sam("PUT", "/v1/admissions/settings", next)).statusCode).toBe(200);
    expect((await sam("GET", "/v1/admissions/settings")).json()).toEqual(next);
    const hoa = await lead(sam, "Hoa P.");
    expect(hoa.score.parts[0]).toMatchObject({ points: 0, max: 0 });
    expect(hoa.score.parts[1]).toMatchObject({ points: 25, max: 25 });
    const d = (await sam("GET", "/v1/admissions/dashboard")).json() as AdmissionsDashboard;
    expect(d.staleDays).toBe(3);
  });

  it("is for staff only, and each organization sees its own pipeline", async () => {
    const tara = await as(TARA_P);
    expect((await tara("GET", "/v1/admissions/leads")).statusCode).toBe(403);
    expect((await tara("POST", "/v1/admissions/leads", draft())).statusCode).toBe(403);
    const lumen = await as(LUMEN_STAFF, LUMEN);
    expect(await leads(lumen)).toEqual([]);
    const sam = await as(SAM);
    const hoa = await lead(sam, "Hoa P.");
    const r = await lumen("PUT", `/v1/admissions/leads/${hoa.id}/assign`, {
      principalId: LUMEN_STAFF,
    });
    expect(r.statusCode).toBe(404);
  });

  it("Billing hooks: first invoice → offer, void → placement, paid → enrolled", async () => {
    const sam = await as(SAM);
    const tuan = await lead(sam, "Tuan K.");
    await sam("PUT", `/v1/admissions/leads/${tuan.id}/stage`, { stage: "placement" });
    const scope = { orgId: NOVA, principalId: SAM, requestId: "billing-test" };
    const at = new Date(NOW);
    await withTenant(t.app, scope, (tx) => attachFirstInvoice(tx, NOVA, tuan.id, "INV-1", at));
    let l = await lead(sam, "Tuan K.");
    expect(l).toMatchObject({ stage: "offer", invoiceNo: "INV-1" });
    // Hand moves are refused while the invoice is open.
    const r = await sam("PUT", `/v1/admissions/leads/${tuan.id}/stage`, { stage: "contacted" });
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toMatch(/INV-1/);
    await withTenant(t.app, scope, (tx) => attachFirstInvoice(tx, NOVA, tuan.id, null, at));
    expect((await lead(sam, "Tuan K.")).stage).toBe("placement");
    await withTenant(t.app, scope, (tx) => attachFirstInvoice(tx, NOVA, tuan.id, "INV-2", at));
    await withTenant(t.app, scope, (tx) => markLeadPaid(tx, NOVA, tuan.id, 4_800_000, at));
    l = await lead(sam, "Tuan K.");
    expect(l).toMatchObject({ stage: "enrolled", firstPaymentVnd: 4_800_000 });
    expect(l.stageHistory.slice(-4).map((h) => h.stage)).toEqual([
      "offer",
      "placement",
      "offer",
      "enrolled",
    ]);
    // An invoice only turns a placement-tested lead into an offer.
    const quan = await lead(sam, "Quan T.");
    await withTenant(t.app, scope, (tx) => attachFirstInvoice(tx, NOVA, quan.id, "INV-3", at));
    expect((await lead(sam, "Quan T.")).stage).toBe(quan.stage);
    // Paying a lead that has no open first invoice changes nothing.
    const hoa = await lead(sam, "Hoa P.");
    await withTenant(t.app, scope, (tx) => markLeadPaid(tx, NOVA, hoa.id, 1, at));
    expect((await lead(sam, "Hoa P.")).stage).toBe("new");
  });

  it("history and activities are insert-only for the application role", async () => {
    const scope = { orgId: NOVA, principalId: SAM, requestId: "x" };
    await expect(
      withTenant(t.app, scope, (tx) =>
        tx.updateTable("lead_history").set({ by_name: "x" }).execute(),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(t.app, scope, (tx) => tx.deleteFrom("lead_activity").execute()),
    ).rejects.toThrow(/permission denied/);
  });
});
