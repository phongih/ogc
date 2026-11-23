// Workforce on the Platform API: teaching hours in the next 7 days vs each teacher's target; staff
// tune targets and thresholds (workforce:manage); suggestions are ranked, nothing is assigned.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LoadCandidate, TeacherLoad, WorkforceOverview } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { A2M, BEN, L, MIA, NOVA, TARA, seedDev, sid } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "workforce-test-secret-0123456789";
const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time
const KHANG = "00000000-0000-4000-8000-00000000t004";
const SAM = "iios-principal-staff-1";
let seq = 0;
const key = () => `wf-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("workforce — API", () => {
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

  const as = async (principalId: string) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId: NOVA }),
    });
    const g = ((await r.json()) as { grant: string }).grant;
    return (method: "GET" | "PUT" | "POST", url: string, body?: unknown) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": NOVA,
          ...(method !== "GET" ? { "idempotency-key": key() } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
  };
  const loadOf = (o: WorkforceOverview, id: string): TeacherLoad =>
    o.teachers.find((x) => x.teacherId === id)!;
  const brief = (c: LoadCandidate[]) =>
    c.map((x) => [x.name, x.after.pct, x.after.band, x.clashes.length > 0]);
  const centerIso = (d: number, hh: number) =>
    new Date(Date.UTC(2026, 10, d, hh - 7)).toISOString();

  it("overview: hours in the next 7 days vs target, most loaded first; staff only", async () => {
    const sam = await as(SAM);
    // outside the window (Tue 1/12 15:00, 8 days ahead): not counted
    const extra = await sam("POST", `/v1/classes/${A2M}/sessions`, {
      title: "Extra",
      at: new Date(Date.UTC(2026, 11, 1, 8)).toISOString(),
    });
    expect(extra.statusCode).toBe(200);
    const o = (await sam("GET", "/v1/workforce")).json() as WorkforceOverview;
    expect(
      o.teachers.map((x) => [x.name, x.hours, x.sessions, x.targetHours, x.pct, x.band]),
    ).toEqual([
      ["Tara", 6, 4, 2.5, 240, "over"],
      ["Ben", 3, 2, 4, 75, "meet"],
      ["Khang", 0, 0, 20, 0, "under"],
      ["Mia", 0, 0, 4.5, 0, "under"],
    ]);
    expect(loadOf(o, TARA).breakdown).toEqual([
      // in the order of their first session in the window (Tue B1 before Wed A2)
      { label: "B1 Evening — Tue/Thu", kind: "class", sessions: 2, hours: 3 },
      { label: "A2 Morning — Mon/Wed", kind: "class", sessions: 2, hours: 3 },
    ]);
    expect(loadOf(o, TARA).classes).toBe(2);
    expect([o.totalHours, o.totalTargetHours, o.utilizationPct, o.bands]).toEqual([
      9,
      31,
      29,
      { under: 2, meet: 1, over: 1 },
    ]);
    expect(o.settings).toEqual({ underPct: 60, overPct: 100 });
    expect((await (await as("iios-principal-teacher-1"))("GET", "/v1/workforce")).statusCode).toBe(
      403,
    );
  });

  it("a substitute's session counts for the substitute; a make-up session counts for its teacher", async () => {
    const sam = await as(SAM);
    expect(
      (await sam("PUT", `/v1/sessions/${sid("k2", 1)}/substitute`, { teacherId: MIA })).statusCode,
    ).toBe(200);
    // Huy's make-up for B1 — Unit 2, Wed 25/11 15:00 with Khang
    const r = await sam(
      "POST",
      `/v1/makeups/${encodeURIComponent(`${sid("k2", -1)}::${L(4)}`)}/makeup-session`,
      {
        at: centerIso(25, 15),
        teacherId: KHANG,
      },
    );
    expect(r.statusCode).toBe(200);
    const o = (await sam("GET", "/v1/workforce")).json() as WorkforceOverview;
    expect([loadOf(o, TARA).hours, loadOf(o, MIA).hours, loadOf(o, KHANG).hours]).toEqual([
      4.5, 1.5, 1.5,
    ]);
    expect(loadOf(o, MIA).breakdown).toEqual([
      { label: "B1 Evening — Tue/Thu", kind: "substitute", sessions: 1, hours: 1.5 },
    ]);
    expect(loadOf(o, KHANG).breakdown).toEqual([
      { label: "B1 Evening — Tue/Thu", kind: "makeup", sessions: 1, hours: 1.5 },
    ]);
  });

  it("targets and thresholds: staff with workforce:manage; validated; bands follow", async () => {
    const sam = await as(SAM);
    const bad = await sam("PUT", `/v1/workforce/teachers/${TARA}/target`, {
      employment: "full_time",
      targetHours: 2.25,
    });
    expect([bad.statusCode, bad.json()]).toEqual([
      422,
      { ok: false, reason: "invalid", detail: "target: 1–40 hours, in half hours" },
    ]);
    expect(
      (
        await sam("PUT", "/v1/workforce/teachers/nobody/target", {
          employment: "full_time",
          targetHours: 8,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await sam("PUT", `/v1/workforce/teachers/${TARA}/target`, {
          employment: "full_time",
          targetHours: 8,
        })
      ).json(),
    ).toEqual({ ok: true });
    expect(
      (await sam("PUT", "/v1/workforce/settings", { underPct: 50, overPct: 90 })).json(),
    ).toMatchObject({ reason: "invalid", detail: "over: 100–200%" });
    expect(
      (await sam("PUT", "/v1/workforce/settings", { underPct: 80, overPct: 150 })).json(),
    ).toEqual({ ok: true });
    const o = (await sam("GET", "/v1/workforce")).json() as WorkforceOverview;
    expect([loadOf(o, TARA).employment, loadOf(o, TARA).pct, loadOf(o, TARA).band]).toEqual([
      "full_time",
      75,
      "under",
    ]);
    expect(loadOf(o, BEN).band).toBe("under"); // 75% < 80%
    expect(o.settings).toEqual({ underPct: 80, overPct: 150 });
    // the Front desk policy has no workforce:manage
    state.attachments.set(SAM, "policy-front-desk-d1");
    const denied = await (
      await as(SAM)
    )("PUT", "/v1/workforce/settings", { underPct: 60, overPct: 100 });
    expect([denied.statusCode, denied.json().reason]).toEqual([403, "access_policy"]);
  });

  it("who has room: a class teacher (the class's own sessions move) and a substitute (clashes last)", async () => {
    const sam = await as(SAM);
    const forClass = (
      await sam("GET", `/v1/workforce/suggest/class/${A2M}`)
    ).json() as LoadCandidate[];
    expect(brief(forClass)).toEqual([
      ["Mia", 66.7, "meet", false],
      ["Khang", 15, "under", false],
      ["Ben", 150, "over", false],
    ]);
    expect(forClass[2].note).toBe("Would go over target (150% of 4 h)");
    const forSession = (
      await sam("GET", `/v1/workforce/suggest/session/${sid("k2", 1)}`)
    ).json() as LoadCandidate[];
    expect(brief(forSession)).toEqual([
      ["Khang", 7.5, "under", false],
      ["Mia", 33.3, "under", false],
      ["Ben", 112.5, "over", true],
    ]);
    expect(forSession[2]).toMatchObject({ note: "Schedule clash" });
    expect(forSession[2].clashes[0]).toMatch(
      /^Ben already teaches A2 Evening — Tue\/Thu on Tue, 24\/11\/2026, 18:00$/,
    );
    expect((await sam("GET", "/v1/workforce/suggest/session/nope")).statusCode).toBe(404);
    // a clash goes last even when that teacher would otherwise fit best: Mia substitutes B1 Evening
    // on Tue 24/11 18:00, then Ben's A2 Evening at the same time needs a substitute
    await sam("PUT", `/v1/sessions/${sid("k2", 1)}/substitute`, { teacherId: MIA });
    const busy = (
      await sam("GET", `/v1/workforce/suggest/session/${sid("k3", 1)}`)
    ).json() as LoadCandidate[];
    expect(brief(busy)).toEqual([
      ["Khang", 7.5, "under", false],
      ["Tara", 240, "over", false],
      ["Mia", 66.7, "meet", true],
    ]);
  });
});
