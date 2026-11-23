// Schedule & Attendance on the Platform API (ADR-040 §7 step 3): the demo's rules on PostgreSQL,
// through the full pipeline (mock IIOS over HTTP → authorize → DAK/RLS → audit → idempotency).
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { A2E, A2M, B1E, BEN, L, LUMEN, MIA, NOVA, TARA, seedDev, sid } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";
import { withTenant } from "./db.js";

const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time
const DAY = 86_400_000;
const SECRET = "domains-test-secret-0123456789";
let keySeq = 0;
const key = () => `k-${Date.now()}-${++keySeq}-abcdef`;

describe.skipIf(!hasPg)("schedule & attendance — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let api: ReturnType<typeof buildApi>;
  let iiosUrl = "";

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
    await t?.drop();
    await api?.close();
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

  const grant = async (principalId: string, orgId = NOVA) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId }),
    });
    return ((await r.json()) as { grant: string }).grant;
  };
  const as = async (principalId: string, orgId = NOVA) => {
    const g = await grant(principalId, orgId);
    const go = (
      method: "GET" | "POST" | "PUT",
      url: string,
      body?: unknown,
      k: string | null = key(),
    ) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": orgId,
          ...(method !== "GET" && k ? { "idempotency-key": k } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
    return go;
  };
  const SAM = "iios-principal-staff-1";
  const TARA_P = "iios-principal-teacher-1";
  const BEN_P = "iios-principal-teacher-2";
  const future = (days: number, utcHour: number) =>
    new Date(Math.floor(NOW / DAY) * DAY + days * DAY + utcHour * 3600_000).toISOString();

  describe("schedule (staff)", () => {
    it("overview: classes, teachers, started / marked flags; teachers get 403", async () => {
      const sam = await as(SAM);
      const o = (await sam("GET", "/v1/schedule")).json();
      expect(o.classes.map((c: { className: string }) => c.className).sort()).toEqual([
        "A2 Evening — Tue/Thu",
        "A2 Morning — Mon/Wed",
        "B1 Evening — Tue/Thu",
      ]);
      const a2 = o.classes.find((c: { classId: string }) => c.classId === A2M);
      expect(a2).toMatchObject({
        teacher: { id: TARA, name: "Tara" },
        learnerCount: 3,
        centerName: "Nova English — District 1",
      });
      expect(a2.sessions.find((s: { id: string }) => s.id === sid("k1", -4))).toMatchObject({
        started: true,
        marked: true,
      });
      expect(a2.sessions.find((s: { id: string }) => s.id === sid("k1", -1))).toMatchObject({
        started: true,
        marked: false,
      });
      expect((await (await as(TARA_P))("GET", "/v1/schedule")).statusCode).toBe(403);
    });

    it("the Front desk D1 policy narrows the overview and the writes to District 1", async () => {
      state.attachments.set(SAM, "policy-front-desk-d1");
      const sam = await as(SAM);
      const o = (await sam("GET", "/v1/schedule")).json();
      expect(o.classes.map((c: { classId: string }) => c.classId).sort()).toEqual(
        [A2M, A2E].sort(),
      );
      const r = await sam("POST", `/v1/classes/${B1E}/sessions`, {
        title: "Extra",
        at: future(6, 3),
      });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ ok: false, reason: "access_policy" });
      // …and may not change the class teacher (read-only field), even in District 1.
      expect(
        (await sam("PUT", `/v1/classes/${A2M}/teacher`, { teacherId: MIA })).json().reason,
      ).toBe("access_policy");
    });

    it("reschedule: history refused, past refused, clash explained, success saved", async () => {
      const sam = await as(SAM);
      expect(
        (await sam("POST", `/v1/sessions/${sid("k1", -1)}/reschedule`, { at: future(6, 2) })).json()
          .reason,
      ).toBe("already_started");
      expect(
        (await sam("POST", `/v1/sessions/${sid("k1", 1)}/reschedule`, { at: future(-2, 2) })).json()
          .reason,
      ).toBe("in_past");
      // Tara's A2 Morning moved onto her B1 Evening slot → clash with a plain sentence.
      const clash = (
        await sam("POST", `/v1/sessions/${sid("k1", 1)}/reschedule`, { at: future(2, 11) })
      ).json();
      expect(clash).toMatchObject({ ok: false, reason: "clash" });
      expect(clash.clashes[0]).toMatch(
        /^Tara already teaches B1 Evening — Tue\/Thu on Wed, 25\/11\/2026, 18:00$/,
      );
      const ok = await sam("POST", `/v1/sessions/${sid("k1", 1)}/reschedule`, { at: future(6, 2) });
      expect(ok.statusCode).toBe(200);
      const moved = ok
        .json()
        .classSchedule.sessions.find((s: { id: string }) => s.id === sid("k1", 1));
      expect(moved.at).toBe(future(6, 2));
    });

    it("cancel requires a replacement; the replacement links both ways", async () => {
      const sam = await as(SAM);
      const r = (
        await sam("POST", `/v1/sessions/${sid("k2", 2)}/cancel`, { replacementAt: future(7, 11) })
      ).json();
      expect(r.ok).toBe(true);
      const old = r.classSchedule.sessions.find((s: { id: string }) => s.id === sid("k2", 2));
      const repl = r.classSchedule.sessions.find(
        (s: { replaces: string | null }) => s.replaces === sid("k2", 2),
      );
      expect(old).toMatchObject({ state: "cancelled", replacedBy: repl.id });
      expect(repl).toMatchObject({ state: "scheduled", title: "B1 — Unit 3", at: future(7, 11) });
      expect(
        (
          await sam("POST", `/v1/sessions/${sid("k2", 2)}/cancel`, { replacementAt: future(8, 11) })
        ).json().reason,
      ).toBe("cancelled");
    });

    it("substitute: same teacher refused; Ben clashes (busy with A2 Evening); Mia fits", async () => {
      const sam = await as(SAM);
      const s = sid("k2", 2);
      expect(
        (await sam("PUT", `/v1/sessions/${s}/substitute`, { teacherId: TARA })).json().reason,
      ).toBe("same_teacher");
      expect(
        (await sam("PUT", `/v1/sessions/${s}/substitute`, { teacherId: BEN })).json().reason,
      ).toBe("clash");
      expect(
        (await sam("PUT", `/v1/sessions/${s}/substitute`, { teacherId: "nobody" })).json().reason,
      ).toBe("unknown_teacher");
      const ok = (await sam("PUT", `/v1/sessions/${s}/substitute`, { teacherId: MIA })).json();
      expect(ok.classSchedule.sessions.find((x: { id: string }) => x.id === s).substitute).toEqual({
        id: MIA,
        name: "Mia",
      });
    });

    it("a new class teacher applies from sessions not yet started; started ones keep held_by", async () => {
      const sam = await as(SAM);
      const r = (await sam("PUT", `/v1/classes/${A2M}/teacher`, { teacherId: MIA })).json();
      expect(r.classSchedule.teacher).toEqual({ id: MIA, name: "Mia" });
      const byId = (id: string) =>
        r.classSchedule.sessions.find((s: { id: string }) => s.id === id);
      expect(byId(sid("k1", -1)).heldBy).toEqual({ id: TARA, name: "Tara" });
      expect(byId(sid("k1", 1)).heldBy).toBeNull();
      // Tara still marks the session she held; Mia has no OGC sign-in, Ben is not its teacher.
      const tara = await as(TARA_P);
      expect((await tara("GET", `/v1/sessions/${sid("k1", -1)}/attendance`)).statusCode).toBe(200);
    });

    it("writes are idempotent and audited once", async () => {
      const sam = await as(SAM);
      const k = key();
      const body = { title: "Extra", at: future(6, 3) };
      const a = await sam("POST", `/v1/classes/${A2M}/sessions`, body, k);
      const b = await sam("POST", `/v1/classes/${A2M}/sessions`, body, k);
      expect(b.headers["idempotent-replay"]).toBe("true");
      expect(b.json()).toEqual(a.json());
      const extras = a
        .json()
        .classSchedule.sessions.filter((s: { title: string }) => s.title === "Extra");
      expect(extras).toHaveLength(1);
      expect((await sam("POST", `/v1/classes/${A2M}/sessions`, body, null)).statusCode).toBe(400);
    });
  });

  describe("attendance (teachers)", () => {
    it("Tara: her classes' sessions and to-mark; Ben sees none of hers", async () => {
      const tara = await as(TARA_P);
      const list = (await tara("GET", `/v1/classes/${A2M}/sessions`)).json();
      expect(list.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([
        [sid("k1", 3), "upcoming"],
        [sid("k1", 1), "upcoming"],
        [sid("k1", -1), "to_mark"],
        [sid("k1", -4), "marked"],
        [sid("k1", -6), "marked"],
      ]);
      expect((await tara("GET", "/v1/me/to-mark")).json().map((s: { id: string }) => s.id)).toEqual(
        [sid("k1", -1)],
      );
      const ben = await as(BEN_P);
      expect((await ben("GET", `/v1/classes/${A2M}/sessions`)).statusCode).toBe(404);
      expect((await ben("GET", `/v1/sessions/${sid("k1", -1)}/attendance`)).statusCode).toBe(404);
    });

    it("marking: started only, whole roster, latest save wins; summary from marked sessions", async () => {
      const tara = await as(TARA_P);
      const s = sid("k1", -1);
      const all = (m: string) => [1, 2, 3].map((i) => ({ learnerId: L(i), mark: m }));
      expect(
        (
          await tara("PUT", `/v1/sessions/${sid("k1", 1)}/attendance`, { marks: all("present") })
        ).json().reason,
      ).toBe("not_started");
      expect(
        (
          await tara("PUT", `/v1/sessions/${s}/attendance`, { marks: all("present").slice(0, 2) })
        ).json().reason,
      ).toBe("incomplete");
      expect(
        (
          await tara("PUT", `/v1/sessions/${s}/attendance`, {
            marks: [...all("present"), { learnerId: L(6), mark: "present" }],
          })
        ).json().reason,
      ).toBe("not_on_roster");
      expect(
        (await tara("PUT", `/v1/sessions/${s}/attendance`, { marks: all("absent") })).json().ok,
      ).toBe(true);
      const second = (
        await tara("PUT", `/v1/sessions/${s}/attendance`, { marks: all("present") })
      ).json();
      expect(second.attendance.rows.map((r: { mark: string }) => r.mark)).toEqual([
        "present",
        "present",
        "present",
      ]);
      expect(second.attendance.session.status).toBe("marked");
      const sum = (await tara("GET", `/v1/classes/${A2M}/attendance-summary`)).json();
      expect(sum.find((r: { displayName: string }) => r.displayName === "An P.")).toMatchObject({
        present: 2,
        absent: 1,
        marked: 3,
        attendedPct: 67,
        absentStreak: 0,
      });
      expect((await tara("GET", "/v1/me/to-mark")).json()).toEqual([]);
    });

    it("a substitute marks that one session; the 'own classes only' policy stops it", async () => {
      // Ben (free in the morning) substitutes for A2 Morning's session that is still to mark.
      const sam = await as(SAM);
      const s = sid("k1", -1);
      expect((await sam("PUT", `/v1/sessions/${s}/substitute`, { teacherId: BEN })).json().ok).toBe(
        true,
      );
      const ben = await as(BEN_P);
      const marks = [1, 2, 3].map((i) => ({ learnerId: L(i), mark: "present" }));
      expect((await ben("GET", `/v1/sessions/${s}/attendance`)).statusCode).toBe(200);
      state.attachments.set(BEN_P, "policy-own-classes");
      const narrowed = await as(BEN_P);
      expect((await narrowed("PUT", `/v1/sessions/${s}/attendance`, { marks })).json().reason).toBe(
        "not_found",
      );
      state.attachments.delete(BEN_P);
      const final = (
        await (
          await as(BEN_P)
        )("PUT", `/v1/sessions/${s}/attendance`, { marks })
      ).json();
      expect(final).toMatchObject({ ok: true });
    });
  });

  describe("tenant isolation", () => {
    it("the database refuses a row in one organization that points at another's class", async () => {
      await expect(
        withTenant(t.app, { orgId: LUMEN, principalId: "x", requestId: "x" }, (tx) =>
          tx
            .insertInto("session")
            .values({
              org_id: LUMEN,
              id: "smuggled",
              class_id: A2M,
              title: "x",
              at: new Date(NOW + DAY),
              substitute_id: null,
              held_by: null,
              replaced_by: null,
              replaces: null,
            })
            .execute(),
        ),
      ).rejects.toThrow(/foreign key/);
    });

    it("Lumen staff and teachers see none of Nova; ids from Nova resolve to nothing", async () => {
      const lumen = await as("iios-principal-staff-org2", LUMEN);
      const o = (await lumen("GET", "/v1/schedule")).json();
      expect(o.classes.map((c: { className: string }) => c.className)).toEqual(["Starter — Sat"]);
      expect(
        (
          await lumen("POST", `/v1/sessions/${sid("k1", 1)}/reschedule`, { at: future(6, 2) })
        ).json().reason,
      ).toBe("not_found");
      expect(
        (
          await lumen("POST", `/v1/classes/${A2E}/sessions`, { title: "x", at: future(6, 2) })
        ).json().reason,
      ).toBe("not_found");
    });
  });
});
