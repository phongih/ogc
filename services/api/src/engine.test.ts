import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  ActionLogEntry,
  EngineEvent,
  EngineNotification,
  JobStatus,
  Rule,
  StudentCard,
} from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { L, LUMEN, NOVA, seedDev, sid } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "engine-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-23T05:00:00Z");
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const TARA = "iios-principal-teacher-1";
const BEN = "iios-principal-teacher-2";
const LINH = "iios-principal-learner-1";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `eng-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("Decision Engine — API", () => {
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
    return (method: "GET" | "POST" | "PUT", url: string, body?: unknown, idem = key()) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": orgId,
          ...(method !== "GET" ? { "idempotency-key": idem } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
  };
  type Call = Awaited<ReturnType<typeof as>>;
  const ownerQuery = async (q: string) => {
    const c = new pg.Client({ connectionString: t.ownerUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.org_id', $1, true)", [NOVA]);
      const r = await c.query(q);
      await c.query("commit");
      return r;
    } finally {
      await c.end();
    }
  };
  const events = async (c: Call) => (await c("GET", "/v1/engine/events")).json() as EngineEvent[];
  const actions = async (c: Call) =>
    (await c("GET", "/v1/engine/actions")).json() as ActionLogEntry[];
  const job = async (c: Call) => (await c("GET", "/v1/engine/job")).json() as JobStatus;
  const inbox = async (c: Call) =>
    (await c("GET", "/v1/me/notifications")).json() as EngineNotification[];
  const rules = async (c: Call) => (await c("GET", "/v1/engine/rules")).json() as Rule[];
  const ruleOf = async (c: Call, kind: string) => (await rules(c)).find((r) => r.kind === kind)!;
  const update = (c: Call, id: string, patch: object) => c("POST", `/v1/engine/rules/${id}`, patch);
  const run = (c: Call) => c("POST", "/v1/engine/run");
  const mark = (c: Call, n: number, an: "present" | "absent") =>
    c("PUT", `/v1/sessions/${sid("k1", n)}/attendance`, {
      marks: [
        { learnerId: L(1), mark: "present" },
        { learnerId: L(2), mark: "present" },
        { learnerId: L(3), mark: an },
      ],
    });
  const MIN = 60_000;

  it("runs when a page asks and the last run is older than 60 s; cooldown keeps an event from repeating", async () => {
    const sam = await as(SAM);
    expect((await job(sam)).runs).toBe(0);
    const ev = await events(sam);
    expect(ev.map((e) => [e.kind, e.subject.label, e.evidence])).toEqual([
      [
        "invoice_overdue",
        "INV-2026-0007 · Vy H.",
        "69 days overdue (due 2026-09-15); balance 6.900.000 ₫ at Nova English — District 1",
      ],
      [
        "invoice_overdue",
        "INV-2026-0004 · Huy D.",
        "69 days overdue (due 2026-09-15); balance 8.400.000 ₫ at Nova English — Thu Duc",
      ],
      [
        "invoice_overdue",
        "INV-2026-0003 · An P.",
        "69 days overdue (due 2026-09-15); balance 3.900.000 ₫ at Nova English — District 1",
      ],
      [
        "skill_low",
        "An P. · A2 Morning — Mon/Wed",
        "Reading is 58, below 60 (placement test only)",
      ],
      [
        "skill_low",
        "Minh T. · A2 Morning — Mon/Wed",
        "Use of English is 52, below 60 (placement test only)",
      ],
      [
        "skill_low",
        "Linh N. · A2 Morning — Mon/Wed",
        "Speaking is 55, below 60 (placement test only)",
      ],
    ]);
    expect(await job(sam)).toMatchObject({ runs: 1, lastDetected: 6, lastNewEvents: 6 });
    // Within 60 s: no new run. After it: a run, but every case is in its cooldown.
    now += 30_000;
    await events(sam);
    expect((await job(sam)).runs).toBe(1);
    now += 31_000;
    await inbox(sam);
    expect(await job(sam)).toMatchObject({
      runs: 2,
      lastDetected: 6,
      lastNewEvents: 0,
      lastSkippedCooldown: 6,
    });
    expect(await events(sam)).toHaveLength(6);
    // After the 24 h cooldown the same cases fire again.
    // (now with Monday's session 24 h unmarked: a seventh case)
    now += 1440 * MIN;
    expect((await run(sam)).json()).toMatchObject({ runs: 3, lastNewEvents: 7 });
    expect((await events(sam)).filter((e) => e.kind === "session_unmarked")).toHaveLength(1);
    expect(await events(sam)).toHaveLength(13);
  });

  it("pages asking at the same moment start one run, not several (lock + re-check)", async () => {
    const [sam, tara] = [await as(SAM), await as(TARA)];
    await Promise.all([events(sam), actions(sam), inbox(sam), inbox(tara), events(sam)]);
    expect(await job(sam)).toMatchObject({ runs: 1, lastNewEvents: 6 });
    expect(await events(sam)).toHaveLength(6);
  });

  it("acts only by log, notification and the support list: staff get invoice notices, learner cases go to the list", async () => {
    const sam = await as(SAM);
    await events(sam);
    const ac = await actions(sam);
    expect(ac.map((a) => [a.action, a.target])).toEqual([
      ["notify_staff", "center staff"],
      ["notify_staff", "center staff"],
      ["notify_staff", "center staff"],
      ["support_queue", "Learners needing support"],
      ["support_queue", "Learners needing support"],
      ["support_queue", "Learners needing support"],
    ]);
    expect((await inbox(sam)).map((n) => n.text)).toEqual([
      "Invoice overdue: INV-2026-0007 · Vy H. — 69 days overdue (due 2026-09-15); balance 6.900.000 ₫ at Nova English — District 1",
      "Invoice overdue: INV-2026-0004 · Huy D. — 69 days overdue (due 2026-09-15); balance 8.400.000 ₫ at Nova English — Thu Duc",
      "Invoice overdue: INV-2026-0003 · An P. — 69 days overdue (due 2026-09-15); balance 3.900.000 ₫ at Nova English — District 1",
    ]);
    expect(await inbox(await as(TARA))).toEqual([]);
    // Nothing else changed: no score, no assignment, no session moved.
    const marks = await ownerQuery("select count(*)::int as n from attendance");
    const sessions = await ownerQuery("select count(*)::int as n from session");
    await run(sam);
    expect((await ownerQuery("select count(*)::int as n from attendance")).rows).toEqual(
      marks.rows,
    );
    expect((await ownerQuery("select count(*)::int as n from session")).rows).toEqual(
      sessions.rows,
    );
  });

  it("a teacher is notified about their own class: attendance not taken, two absences in a row", async () => {
    const tara = await as(TARA);
    const ben = await as(BEN);
    // k1-m1 (Monday 09:00) is not marked: 24 h after it started, Tara and staff are told.
    now += 22 * 60 * MIN;
    const sam = await as(SAM);
    expect((await run(sam)).statusCode).toBe(200);
    const t = await inbox(tara);
    expect(t.map((n) => n.text)).toEqual([
      expect.stringMatching(
        /^Attendance not taken: A2 — Unit 6 · A2 Morning — Mon\/Wed — Started Mon, 23\/11\/2026, 09:00; attendance not taken$/,
      ),
    ]);
    expect(t[0].priority).toBe("P1");
    expect(await inbox(ben)).toEqual([]);
    expect((await inbox(sam)).some((n) => n.text.startsWith("Attendance not taken"))).toBe(true);
    // Tara marks it with An absent (second in a row): P1 to Tara + the support list.
    expect((await mark(tara, -1, "absent")).statusCode).toBe(200);
    expect((await run(sam)).statusCode).toBe(200);
    const abs = (await events(sam)).find((e) => e.kind === "absence_streak")!;
    expect([abs.priority, abs.subject.label, abs.evidence]).toEqual([
      "P1",
      "An P. · A2 Morning — Mon/Wed",
      "Absent from the last 2 marked sessions",
    ]);
    expect(
      (await actions(sam)).filter((a) => a.eventId === abs.id).map((a) => [a.action, a.target]),
    ).toEqual([
      ["notify_teacher", "Tara"], // newest first
      ["support_queue", "Learners needing support"],
    ]);
    expect((await inbox(tara))[0].text).toBe(
      "Absent several sessions in a row: An P. · A2 Morning — Mon/Wed — Absent from the last 2 marked sessions",
    );
    // Read: one, then all; someone else's notification is not theirs to mark.
    const first = (await inbox(tara))[0].id;
    expect((await ben("POST", `/v1/me/notifications/${first}/read`)).json()).toEqual({ ok: true });
    expect((await inbox(tara)).find((n) => n.id === first)!.read).toBe(false);
    expect((await tara("POST", `/v1/me/notifications/${first}/read`)).json()).toEqual({ ok: true });
    expect((await inbox(tara)).map((n) => n.read)).toEqual([true, false]);
    await tara("POST", "/v1/me/notifications/all/read");
    expect((await inbox(tara)).every((n) => n.read)).toBe(true);
    expect((await (await as(LINH))("GET", "/v1/me/notifications")).statusCode).toBe(403);
  });

  it("teacher load, class-course activity and make-ups, each under its rule", async () => {
    const sam = await as(SAM);
    // Teacher load: more than 1 session in the next 7 days.
    const load = await ruleOf(sam, "teacher_overload");
    expect((await update(sam, load.id, { params: { sessionsPerWeek: 1 } })).json().ok).toBe(true);
    // Class-course activity (off by default): on, 14 days — A2 Morning was linked 20 days ago.
    const studio = await ruleOf(sam, "studio_inactive");
    expect((await update(sam, studio.id, { enabled: true })).json().ok).toBe(true);
    await run(sam);
    const ev = await events(sam);
    expect(
      ev
        .filter((e) => e.kind === "teacher_overload")
        .map((e) => e.subject.label)
        .sort(),
    ).toEqual(["Ben", "Tara"]);
    const inactive = ev.filter((e) => e.kind === "studio_inactive");
    expect(inactive.map((e) => e.subject.label).sort()).toEqual(["An P.", "Linh N.", "Minh T."]);
    expect(inactive[0].evidence).toMatch(
      /^No class course activity since .* in "A2 Everyday English — Units 6–8" \(A2 Morning — Mon\/Wed\)$/,
    );
    expect(
      (await inbox(await as(TARA))).some((n) => n.text.startsWith("No class course activity")),
    ).toBe(true);
    // 15 days on: An's and Huy's make-ups are past their 14-day deadline (staff and teacher told).
    now += 15 * 24 * 60 * MIN;
    await run(sam);
    const over = (await events(sam)).filter((e) => e.kind === "makeup_overdue");
    expect(over.map((e) => e.subject.label.split(" · ")[0]).sort()).toEqual(["An P.", "Huy D."]);
    expect(over[0].evidence).toMatch(/^Not made up; deadline .* has passed$/);
  });

  it("rules: staff with engine:manage tune them within ranges; Current Students follows the rules", async () => {
    const sam = await as(SAM);
    const low = await ruleOf(sam, "skill_low");
    const bad = async (patch: object, detail: RegExp) => {
      const r = await update(sam, low.id, patch);
      expect([r.statusCode, r.json().reason]).toEqual([422, "invalid"]);
      expect(r.json().detail).toMatch(detail);
    };
    await bad({ params: { threshold: 0 } }, /skill below must be 1–100/);
    await bad({ params: { days: 3 } }, /unknown threshold/);
    await bad({ kind: "invoice_overdue" }, /only enabled/);
    await bad({ actions: [] }, /at least one action/);
    await bad({ actions: ["email_parents"] }, /unknown action/);
    await bad({ cooldownMin: 20000 }, /cooldown/);
    const inv = await ruleOf(sam, "invoice_overdue");
    const q = await update(sam, inv.id, { actions: ["support_queue"] });
    expect([q.statusCode, q.json().detail]).toEqual([
      422,
      "only learner rules can use the support queue",
    ]);
    expect((await update(sam, "R-99", { enabled: false })).statusCode).toBe(404);
    // Threshold 56: An's Reading 58 is no longer low; Linh (55) and Minh (52) still are.
    const ok = await update(sam, low.id, { params: { threshold: 56 } });
    expect(ok.json()).toMatchObject({ ok: true, rule: { params: { threshold: 56 } } });
    const watch = async () =>
      ((await (await as(SAM))("GET", "/v1/students")).json() as StudentCard[])
        .filter((c) => c.care.level !== "ok")
        .map((c) => c.name);
    expect(await watch()).toEqual(["Linh N.", "Minh T."]);
    // Paused: no skill evidence at all.
    expect((await update(sam, low.id, { enabled: false })).json().ok).toBe(true);
    expect(await watch()).toEqual([]);
    const row = await ownerQuery(
      `select enabled, updated_by from engine_rule where id = '${low.id}'`,
    );
    expect(row.rows[0]).toEqual({ enabled: false, updated_by: "Sam (Org Staff)" });
    // Teachers and learners cannot read or change rules.
    expect((await (await as(TARA))("GET", "/v1/engine/rules")).statusCode).toBe(403);
    const t = await update(await as(TARA), low.id, { enabled: true });
    expect([t.statusCode, t.json().reason]).toEqual([403, "not_staff"]);
    expect((await run(await as(TARA))).statusCode).toBe(403);
  });

  it("the access policy decides: no engine:manage → refused; actions read-only → the rest still tunes", async () => {
    state.attachments.set(SAM, "policy-front-desk-d1"); // no engine:manage
    const fd = await as(SAM);
    const low = await ruleOf(fd, "skill_low");
    const r = await update(fd, low.id, { enabled: false });
    expect([r.statusCode, r.json().reason]).toEqual([403, "access_policy"]);
    const o = await as(OLIVIA);
    const made = await o("POST", "/v1/access/policies", {
      name: "Engine thresholds",
      rules: [{ action: "engine:manage", readonlyFields: ["actions"] }],
    });
    expect(made.statusCode).toBe(200);
    const ref = (made.json().view.policies as { id: string; name: string }[]).find(
      (p) => p.name === "Engine thresholds",
    )!.id;
    state.attachments.set(SAM, ref);
    const sam = await as(SAM);
    const a = await update(sam, low.id, { actions: ["log_only"] });
    expect([a.statusCode, a.json().detail]).toEqual([403, "rule actions are read-only for you"]);
    expect((await update(sam, low.id, { params: { threshold: 50 } })).json().ok).toBe(true);
    expect((await update(sam, low.id, { actions: [...low.actions] })).json().ok).toBe(true);
  });

  it("tenants are separate; events and actions cannot be changed", async () => {
    await events(await as(SAM));
    const lumen = await as(LUMEN_STAFF, LUMEN);
    const lev = await events(lumen);
    expect(lev.every((e) => !e.subject.label.includes("Vy H."))).toBe(true);
    expect((await job(lumen)).runs).toBe(1);
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    try {
      for (const q of [
        "update engine_event set evidence = 'x'",
        "delete from engine_event",
        "delete from engine_action",
        "update engine_rule set kind = 'x'",
      ]) {
        await app.query("begin");
        await app.query("select set_config('app.org_id', $1, true)", [NOVA]);
        await expect(app.query(q)).rejects.toThrow(/permission denied/);
        await app.query("rollback");
      }
    } finally {
      await app.end();
    }
    await expect(ownerQuery("update engine_event set evidence = 'x'")).rejects.toThrow(/immutable/);
  });
});
