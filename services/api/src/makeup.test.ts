// Make-up ledger on the Platform API: items derived from attendance, staff arrangements, guests on
// the attendance sheet, self-study (learner submits, guardian reads, class teacher confirms).
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { MakeupBoard, MakeupItem } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { withTenant } from "./db.js";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { L, LUMEN, MIA, NOVA, TARA, seedDev, sid } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "makeup-test-secret-0123456789";
const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time
const H = 3_600_000;
const SAM = "iios-principal-staff-1";
const TARA_P = "iios-principal-teacher-1";
const BEN_P = "iios-principal-teacher-2";
const LINH = "iios-principal-learner-1";
const MAI = "iios-principal-guardian-1";
const AN_ITEM = `${sid("k1", -2)}::${L(3)}`; // An absent at A2 — Unit 5 (Wed 18/11)
const HUY_ITEM = `${sid("k2", -1)}::${L(4)}`; // Huy absent at B1 — Unit 2 (Thu 19/11)
let seq = 0;
const key = () => `mk-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("make-ups — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let iiosUrl = "";
  const apis: ReturnType<typeof buildApi>[] = [];
  const apiAt = async (now: number) => {
    const a = buildApi({
      db: t.app,
      iios: httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
      now: () => now,
    });
    await a.ready();
    apis.push(a);
    return a;
  };

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
    for (const a of apis.splice(0)) await a.close();
    await t?.drop();
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
    state.attachments.clear();
  });
  afterAll(async () => {
    for (const a of apis) await a.close();
    await iios?.close();
    await t?.drop();
  });

  const as = async (principalId: string, now = NOW, orgId = NOVA) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId }),
    });
    const g = ((await r.json()) as { grant: string }).grant;
    const api = await apiAt(now);
    return (
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
  };
  const enc = encodeURIComponent;
  const item = (board: MakeupBoard, id: string): MakeupItem =>
    board.items.find((i) => i.id === id)!;
  const centerIso = (y: number, mo: number, d: number, hh: number) =>
    new Date(Date.UTC(y, mo - 1, d, hh - 7)).toISOString();

  it("items come from absences: overdue / open first; staff only; a D1 policy narrows the board", async () => {
    const sam = await as(SAM);
    const b = (await sam("GET", "/v1/makeups")).json();
    expect(b.items.map((i: { id: string }) => i.id).sort()).toEqual([AN_ITEM, HUY_ITEM].sort());
    expect(item(b, AN_ITEM)).toMatchObject({
      learnerName: "An P.",
      className: "A2 Morning — Mon/Wed",
      unitTitle: "A2 — Unit 5",
      status: "open",
      overdue: false,
      dueAt: centerIso(2026, 12, 2, 9),
    });
    expect(b.counts).toEqual({ open: 2, booked: 0, toConfirm: 0, done: 0, overdue: 0 });
    expect((await (await as(TARA_P))("GET", "/v1/makeups")).statusCode).toBe(403);
    // 15 days later both are overdue
    const late = (await (await as(SAM, NOW + 15 * 24 * H))("GET", "/v1/makeups")).json();
    expect(late.counts.overdue).toBe(2);
    state.attachments.set(SAM, "policy-front-desk-d1");
    const d1 = (await (await as(SAM))("GET", "/v1/makeups")).json();
    expect(d1.items.map((i: { id: string }) => i.id)).toEqual([AN_ITEM]);
    const r = await (await as(SAM))("POST", `/v1/makeups/${enc(HUY_ITEM)}/self-study`);
    expect([r.statusCode, r.json().reason]).toEqual([403, "access_policy"]);
  });

  it("join another class of the same course; the guest is on that sheet; present closes the item", async () => {
    const sam = await as(SAM);
    const opts = (await sam("GET", `/v1/makeups/${enc(AN_ITEM)}/options`)).json();
    expect(opts).toEqual([
      expect.objectContaining({
        sessionId: sid("k3", 1),
        kind: "join",
        className: "A2 Evening — Tue/Thu",
        teacherName: "Ben",
      }),
    ]);
    expect(
      (await sam("POST", `/v1/makeups/${enc(AN_ITEM)}/book`, { sessionId: sid("k1", 1) })).json()
        .reason,
    ).toBe("not_an_option");
    const k = key();
    const ok = await sam(
      "POST",
      `/v1/makeups/${enc(AN_ITEM)}/book`,
      { sessionId: sid("k3", 1) },
      k,
    );
    expect(item(ok.json().board, AN_ITEM)).toMatchObject({
      status: "booked",
      booking: { kind: "join", sessionId: sid("k3", 1), teacherName: "Ben" },
    });
    expect(
      (await sam("POST", `/v1/makeups/${enc(AN_ITEM)}/book`, { sessionId: sid("k3", 1) }, k))
        .headers["idempotent-replay"],
    ).toBe("true");

    // Tue 24/11 19:00 — Ben marks his class plus the guest
    const later = Date.parse(centerIso(2026, 11, 24, 19));
    const ben = await as(BEN_P, later);
    const sheet = (await ben("GET", `/v1/sessions/${sid("k3", 1)}/attendance`)).json();
    expect(
      sheet.rows.map((r: { displayName: string; makeupFor: string | null }) => [
        r.displayName,
        r.makeupFor,
      ]),
    ).toEqual([
      ["Khoa L.", null],
      ["Vy H.", null],
      ["An P.", "A2 Morning — Mon/Wed"],
    ]);
    const two = [6, 7].map((n) => ({ learnerId: L(n), mark: "present" }));
    expect(
      (await ben("PUT", `/v1/sessions/${sid("k3", 1)}/attendance`, { marks: two })).json().reason,
    ).toBe("incomplete");
    const saved = await ben("PUT", `/v1/sessions/${sid("k3", 1)}/attendance`, {
      marks: [...two, { learnerId: L(3), mark: "late" }],
    });
    expect(saved.statusCode).toBe(200);
    const after = (await (await as(SAM, later))("GET", "/v1/makeups")).json();
    expect(item(after, AN_ITEM).status).toBe("done");
    expect(after.counts.done).toBe(1);
    // done items are final for arrangements
    expect(
      (await (await as(SAM, later))("POST", `/v1/makeups/${enc(AN_ITEM)}/self-study`)).json()
        .reason,
    ).toBe("already_done");
  });

  it("a make-up session books everyone missing the unit; teacher clash, past time and unknown teacher refused", async () => {
    const sam = await as(SAM);
    const url = `/v1/makeups/${enc(HUY_ITEM)}/makeup-session`;
    // Tara teaches B1 Evening on Tue 24/11 18:00
    const clash = (
      await sam("POST", url, { at: centerIso(2026, 11, 24, 18), teacherId: TARA })
    ).json();
    expect(clash).toMatchObject({ ok: false, reason: "clash" });
    expect(clash.clashes[0]).toMatch(
      /^Tara already teaches B1 Evening — Tue\/Thu on Tue, 24\/11\/2026, 18:00$/,
    );
    expect(
      (await sam("POST", url, { at: centerIso(2026, 11, 20, 15), teacherId: MIA })).json().reason,
    ).toBe("in_past");
    expect(
      (await sam("POST", url, { at: centerIso(2026, 11, 25, 15), teacherId: "nobody" })).json()
        .reason,
    ).toBe("unknown_teacher");
    const ok = await sam("POST", url, { at: centerIso(2026, 11, 25, 15), teacherId: MIA });
    expect(ok.statusCode).toBe(200);
    const huy = item(ok.json().board, HUY_ITEM);
    expect(huy).toMatchObject({
      status: "booked",
      booking: { kind: "makeup", teacherName: "Mia", at: centerIso(2026, 11, 25, 15) },
    });
    // the session is on the schedule as a make-up taught by Mia (substitute)
    const sched = (await sam("GET", "/v1/schedule")).json();
    const mk = sched.classes
      .flatMap((c: { sessions: { id: string }[] }) => c.sessions)
      .find((s: { id: string }) => s.id === huy.booking!.sessionId);
    expect(mk).toMatchObject({
      kind: "makeup",
      title: "B1 — Unit 2",
      substitute: { id: MIA, name: "Mia" },
    });
    // nothing left open for that unit
    expect(
      (await sam("POST", url, { at: centerIso(2026, 11, 26, 15), teacherId: MIA })).json().reason,
    ).toBe("nothing_open");
  });

  it("self-study: staff assign → learner submits → guardian reads → class teacher returns, then confirms", async () => {
    // Linh is absent this morning (Mon 23/11 09:00): Tara marks
    const tara = await as(TARA_P);
    await tara("PUT", `/v1/sessions/${sid("k1", -1)}/attendance`, {
      marks: [
        { learnerId: L(1), mark: "absent" },
        { learnerId: L(2), mark: "present" },
        { learnerId: L(3), mark: "present" },
      ],
    });
    const LINH_ITEM = `${sid("k1", -1)}::${L(1)}`;
    const sam = await as(SAM);
    expect(
      item((await sam("POST", `/v1/makeups/${enc(LINH_ITEM)}/self-study`)).json().board, LINH_ITEM),
    ).toMatchObject({
      status: "booked",
      booking: { kind: "selfstudy", teacherName: "Tara" },
    });
    const linh = await as(LINH);
    expect((await linh("GET", "/v1/me/makeups")).json().map((i: { id: string }) => i.id)).toEqual([
      LINH_ITEM,
    ]);
    expect(
      (await linh("POST", `/v1/me/makeups/${enc(LINH_ITEM)}/self-study`, { note: "short" })).json()
        .reason,
    ).toBe("note_required");
    expect(
      (
        await linh("POST", `/v1/me/makeups/${enc(AN_ITEM)}/self-study`, {
          note: "not my item at all",
        })
      ).statusCode,
    ).toBe(404);
    const sub = await linh("POST", `/v1/me/makeups/${enc(LINH_ITEM)}/self-study`, {
      note: "Did Unit 6 exercises 1–4",
    });
    expect(sub.json().item).toMatchObject({
      status: "to_confirm",
      booking: { selfStudy: { note: "Did Unit 6 exercises 1–4" } },
    });

    const mai = await as(MAI);
    expect(
      (await mai("GET", "/v1/me/makeups"))
        .json()
        .map((i: { id: string; status: string }) => [i.id, i.status]),
    ).toEqual([[LINH_ITEM, "to_confirm"]]);
    expect(
      (
        await mai("POST", `/v1/me/makeups/${enc(LINH_ITEM)}/self-study`, {
          note: "guardian writes this",
        })
      ).statusCode,
    ).toBe(404);

    expect(
      (await tara("GET", "/v1/me/makeups/to-confirm")).json().map((i: { id: string }) => i.id),
    ).toEqual([LINH_ITEM]);
    expect(
      (await (await as(BEN_P))("POST", `/v1/makeups/${enc(LINH_ITEM)}/confirm`)).statusCode,
    ).toBe(404);
    expect(
      (await tara("POST", `/v1/makeups/${enc(LINH_ITEM)}/return`, { note: " " })).json().reason,
    ).toBe("note_required");
    const ret = await tara("POST", `/v1/makeups/${enc(LINH_ITEM)}/return`, {
      note: "Please add exercise 5",
    });
    expect(ret.json().item).toMatchObject({
      status: "booked",
      booking: { selfStudy: { returnedNote: "Please add exercise 5", submittedAt: null } },
    });
    expect((await tara("POST", `/v1/makeups/${enc(LINH_ITEM)}/confirm`)).json().reason).toBe(
      "not_submitted",
    );
    await linh("POST", `/v1/me/makeups/${enc(LINH_ITEM)}/self-study`, {
      note: "Exercises 1–5 done now",
    });
    const conf = await tara("POST", `/v1/makeups/${enc(LINH_ITEM)}/confirm`);
    expect(conf.json().item.status).toBe("done");
    expect((await tara("POST", `/v1/makeups/${enc(LINH_ITEM)}/confirm`)).json().reason).toBe(
      "already_done",
    );

    // correcting the absence removes the item altogether
    await tara("PUT", `/v1/sessions/${sid("k1", -1)}/attendance`, {
      marks: [1, 2, 3].map((n) => ({ learnerId: L(n), mark: "present" })),
    });
    expect((await linh("GET", "/v1/me/makeups")).json()).toEqual([]);
  });

  it("a booking into a session that gets cancelled counts as open again", async () => {
    const sam = await as(SAM);
    await sam("POST", `/v1/makeups/${enc(AN_ITEM)}/book`, { sessionId: sid("k3", 1) });
    const c = await sam("POST", `/v1/sessions/${sid("k3", 1)}/cancel`, {
      replacementAt: centerIso(2026, 11, 30, 18),
    });
    expect(c.statusCode).toBe(200);
    expect(item((await sam("GET", "/v1/makeups")).json(), AN_ITEM)).toMatchObject({
      status: "open",
      booking: { sessionId: sid("k3", 1) },
    });
  });

  it("tenants are isolated; guardian links cannot be written by the application role", async () => {
    const lumen = await as("iios-principal-staff-org2", NOW, LUMEN);
    expect((await lumen("GET", "/v1/makeups")).json().items).toEqual([]);
    expect((await lumen("POST", `/v1/makeups/${enc(AN_ITEM)}/self-study`)).statusCode).toBe(404);
    await expect(
      withTenant(t.app, { orgId: NOVA, principalId: "x", requestId: "x" }, (tx) =>
        tx
          .insertInto("guardian_link")
          .values({
            org_id: NOVA,
            guardian_principal_id: "iios-principal-guardian-1",
            learner_id: L(3),
          })
          .execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
