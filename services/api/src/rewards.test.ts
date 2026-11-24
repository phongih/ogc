// Gamification on the Platform API (owner 24/11; the demo's rules, shared in @ogc/contracts):
// rewards derived from learning evidence only (class-course lessons + quiz scores, approved speaking,
// make-ups done), XP / level / streak in center time / badges / weekly class leaderboard; learners
// and guardians see them (guardians: rank only); staff with rewards:manage tune the catalog.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyGamificationUpdate,
  DEFAULT_GAMIFICATION,
  deriveRewards,
  rankClass,
  streakOf,
  type GamificationSettings,
  type LearnerGamification,
  type RewardEvent,
} from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { L, LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "rewards-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-24T05:00:00Z"); // Tue 12:00 center time
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const LINH = "iios-principal-learner-1";
const MAI = "iios-principal-guardian-1";
const MINH = "iios-principal-learner-2";
let seq = 0;
const key = () => `rew-${Date.now()}-${++seq}-abc`;

describe("shared rules (no database)", () => {
  const ev = (at: string): RewardEvent => ({
    at,
    kind: "activity_completed",
    xp: 10,
    evidence: "x",
  });
  it("the streak counts learning days in center time, ending today or yesterday", () => {
    const now = Date.parse("2026-11-24T05:00:00Z"); // 24/11 12:00 in Ho Chi Minh City
    // 23/11 17:30Z is already 24/11 00:30 center time; 22/11 18:00Z is 23/11 01:00
    expect(streakOf([ev("2026-11-23T17:30:00Z"), ev("2026-11-22T18:00:00Z")], now)).toEqual({
      days: 2,
      today: true,
    });
    // nothing today yet: the streak still stands from yesterday
    expect(streakOf([ev("2026-11-22T18:00:00Z")], now)).toEqual({ days: 1, today: false });
    // a gap of one day breaks it
    expect(streakOf([ev("2026-11-22T10:00:00Z")], now)).toEqual({ days: 0, today: false });
    // UTC dates would say 23/11 and 22/11 — center time says the same day twice
    expect(streakOf([ev("2026-11-23T16:59:00Z"), ev("2026-11-23T00:00:00Z")], now).days).toBe(1);
  });
  it("equal weekly XP share a rank; names break the order only", () => {
    const r = rankClass(
      [
        { learnerId: "a", name: "Minh", weeklyXp: 0 },
        { learnerId: "b", name: "Linh", weeklyXp: 30 },
        { learnerId: "c", name: "An", weeklyXp: 0 },
      ],
      "a",
    );
    expect(r.map((x) => [x.rank, x.name, x.you])).toEqual([
      [1, "Linh", false],
      [2, "An", false],
      [2, "Minh", true],
    ]);
  });
  it("a late make-up gives XP but not the on-time badge; only 100% is a perfect score", () => {
    const d = deriveRewards(
      [
        {
          kind: "makeup",
          at: "2026-11-20T10:00:00Z",
          dueAt: "2026-11-19T10:00:00Z",
          unitTitle: "A2 — Unit 5",
          className: "A2 Morning",
        },
        { kind: "activity", at: "2026-11-21T10:00:00Z", title: "At the market", score: 80 },
      ],
      DEFAULT_GAMIFICATION,
    );
    expect(d.onTimeMakeup).toBe(null);
    expect(d.perfect).toBe(null);
    expect(d.first).toBe("2026-11-21T10:00:00Z");
    expect(d.events.map((e) => [e.kind, e.xp])).toEqual([
      ["activity_completed", 10],
      ["practice_scored", 16],
      ["makeup_done", 15],
    ]);
  });
  it("updates stay inside the closed catalog", () => {
    const s: GamificationSettings = DEFAULT_GAMIFICATION;
    expect(applyGamificationUpdate(s, { levelSize: 5 })).toEqual({
      ok: false,
      detail: "XP per level must be 10–1000",
    });
    const ok = applyGamificationUpdate(s, {
      badges: [{ kind: "first_activity", threshold: 3 }], // no threshold on this badge: ignored
    });
    expect(ok.ok && ok.settings.badges[0]!.threshold).toBe(null);
    expect(DEFAULT_GAMIFICATION.levelSize).toBe(100); // the default is never changed in place
  });
});

describe.skipIf(!hasPg)("gamification — API", () => {
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
    return (method: "GET" | "POST", url: string, body?: unknown) =>
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
  const mine = async (c: Call) =>
    (await c("GET", "/v1/me/rewards")).json() as LearnerGamification[];
  const badge = (g: LearnerGamification, kind: string) => g.badges.find((b) => b.kind === kind);
  const reason = (r: { json: () => unknown }) => (r.json() as { reason: string }).reason;
  const detailOf = (r: { json: () => unknown }) => (r.json() as { detail?: string }).detail ?? "";

  it("a learner: XP, level, streak, badges and the class leaderboard — all from evidence", async () => {
    const [g] = await mine(await as(LINH));
    expect(g).toMatchObject({
      learnerId: L(1),
      displayName: "Linh N.",
      xp: 30, // "Making plans" completed yesterday (+10) with a 100% quiz (+20)
      level: 1,
      xpIntoLevel: 30,
      levelSize: 100,
      streakDays: 1,
      activeToday: false,
      weeklyXp: 30,
    });
    expect(g!.recent.map((e) => [e.kind, e.xp, e.evidence])).toEqual([
      ["activity_completed", 10, "Making plans · completed"],
      ["practice_scored", 20, "Making plans · scored 100%"],
    ]);
    expect(badge(g!, "first_activity")!.earned).toBe(true);
    expect(badge(g!, "perfect_score")!.earned).toBe(true);
    expect(badge(g!, "speaking_approved")!.earned).toBe(false); // the rehearsal still waits
    expect(badge(g!, "streak")).toMatchObject({
      earned: false,
      how: "Learn on this many days in a row. (7 days)",
    });
    expect(g!.leaderboard).toEqual({
      className: "A2 Morning — Mon/Wed",
      size: 3,
      yourRank: 1,
      top: [
        { rank: 1, name: "Linh N.", weeklyXp: 30, you: true },
        { rank: 2, name: "An P.", weeklyXp: 0, you: false }, // An's lesson was 18 days ago
        { rank: 2, name: "Minh T.", weeklyXp: 0, you: false },
      ],
    });
  });

  it("a guardian sees the child's rank, never classmates' names; teachers and staff see no XP", async () => {
    const [g] = await mine(await as(MAI));
    expect(g).toMatchObject({ learnerId: L(1), xp: 30 });
    expect(g!.leaderboard).toMatchObject({ yourRank: 1, size: 3, top: [] });
    expect(JSON.stringify(g)).not.toContain("An P.");
    for (const p of [TARA, SAM]) {
      const r = await (await as(p))("GET", "/v1/me/rewards");
      expect(r.statusCode).toBe(403);
    }
  });

  it("an approved speaking rehearsal and a confirmed make-up add XP and badges at once", async () => {
    const tara = await as(TARA);
    const d = await tara("POST", "/v1/speaking-reviews/decide", {
      learnerId: L(1),
      ref: "CS-A2-EVERYDAY",
      lessonId: "a2-l3",
      blockId: "a2-l3-b5",
      attempt: 1,
      decision: "approve",
    });
    expect(d.statusCode).toBe(200);
    let [g] = await mine(await as(LINH));
    expect(g!.xp).toBe(55);
    expect(g!.recent[0]).toMatchObject({
      kind: "speaking_approved",
      xp: 25,
      evidence: "Speaking · Making plans · approved by your teacher",
    });
    expect(g!.activeToday).toBe(true);
    expect(g!.streakDays).toBe(2);
    expect(badge(g!, "speaking_approved")!.earned).toBe(true);

    // a make-up done before its deadline: Minh missed k1-m2; self-study confirmed by Tara
    await ownerQuery(
      "update attendance set mark = 'absent' where session_id = 'k1-m2' and learner_id = $1",
      [L(2)],
    );
    await ownerQuery(
      `insert into makeup_selfstudy (org_id, missed_session_id, learner_id, assigned_by, submitted_at, note, confirmed_at, confirmed_by)
       values ($1, 'k1-m2', $2, 'Sam', $3, 'Studied the unit at home', $3, 'Tara')`,
      [NOVA, L(2), new Date(NOW - 3_600_000)],
    );
    const [minh] = await mine(await as(MINH));
    expect(minh).toMatchObject({
      displayName: "Minh T.",
      xp: 15,
      streakDays: 1,
      activeToday: true,
    });
    expect(minh!.recent).toEqual([
      expect.objectContaining({
        kind: "makeup_done",
        xp: 15,
        evidence: expect.stringMatching(/^Made up A2 — Unit \d+ \(A2 Morning — Mon\/Wed\)$/),
      }),
    ]);
    expect(badge(minh!, "makeup_on_time")!.earned).toBe(true);
    expect(badge(minh!, "first_activity")!.earned).toBe(false); // a make-up is not an activity
    [g] = await mine(await as(LINH));
    expect(g!.leaderboard!.top.map((r) => [r.rank, r.name, r.weeklyXp])).toEqual([
      [1, "Linh N.", 55],
      [2, "Minh T.", 15],
      [3, "An P.", 0],
    ]);
    // a make-up only booked (not attended / not confirmed) gives nothing
    await ownerQuery("update makeup_selfstudy set confirmed_at = null, confirmed_by = null");
    expect((await mine(await as(MINH)))[0]!.xp).toBe(0);
  });

  it("staff with rewards:manage tune the catalog; the next read follows it", async () => {
    const sam = await as(SAM);
    expect(
      ((await sam("GET", "/v1/rewards/settings")).json() as GamificationSettings).levelSize,
    ).toBe(100);
    const r = await sam("POST", "/v1/rewards/settings", {
      rules: [
        { kind: "practice_scored", xp: 50 },
        { kind: "activity_completed", enabled: false },
      ],
      badges: [{ kind: "level", threshold: 2 }],
      levelSize: 40,
      leaderboardEnabled: false,
    });
    expect(r.statusCode).toBe(200);
    const [g] = await mine(await as(LINH));
    expect(g).toMatchObject({
      xp: 50,
      level: 2,
      xpIntoLevel: 10,
      levelSize: 40,
      leaderboard: null,
    });
    expect(g!.recent.map((e) => e.kind)).toEqual(["practice_scored"]);
    expect(badge(g!, "level")).toMatchObject({ earned: true, how: "Reach this level. (2)" });
    const s = (await sam("GET", "/v1/rewards/settings")).json() as GamificationSettings;
    expect(s.rules.find((x) => x.kind === "speaking_approved")).toMatchObject({
      enabled: true,
      xp: 25,
    }); // untouched
    // a partial change keeps the rest
    await sam("POST", "/v1/rewards/settings", { leaderboardEnabled: true });
    const s2 = (await sam("GET", "/v1/rewards/settings")).json() as GamificationSettings;
    expect([s2.levelSize, s2.leaderboardEnabled, s2.rules[1]!.xp]).toEqual([40, true, 50]);

    for (const [body, detail] of [
      [{ levelSize: 5 }, /XP per level/],
      [{ rules: [{ kind: "practice_scored", xp: 101 }] }, /XP must be 0–100/],
      [{ rules: [{ kind: "practice_scored", xp: "5" }] }, /XP must be 0–100/],
      [{ rules: [{ kind: "login_daily", xp: 5 }] }, /unknown reward login_daily/],
      [{ rules: [{ kind: "practice_scored", bonus: 5 }] }, /unknown field/],
      [{ badges: [{ kind: "streak", threshold: 0 }] }, /threshold must be 1–365/],
      [{ badges: [{ kind: "first_login" }] }, /unknown badge first_login/],
      [{ badges: [{ kind: "streak", enabled: "yes" }] }, /threshold must be 1–365/],
      [{ leaderboardEnabled: "on" }, /on or off/],
      [{ freeXp: 100 }, /unknown field/],
    ] as const) {
      const x = await sam("POST", "/v1/rewards/settings", body);
      expect(x.statusCode, JSON.stringify(body)).toBe(422);
      expect(detailOf(x)).toMatch(detail);
    }
    expect(
      ((await sam("GET", "/v1/rewards/settings")).json() as GamificationSettings).levelSize,
    ).toBe(40);

    const tara = await as(TARA);
    expect(reason(await tara("POST", "/v1/rewards/settings", { levelSize: 50 }))).toBe("not_staff");
    expect((await tara("GET", "/v1/rewards/settings")).statusCode).toBe(403);
    state.attachments.set(SAM, "policy-front-desk-d1"); // no rewards:manage
    const p = await sam("POST", "/v1/rewards/settings", { levelSize: 50 });
    expect(p.statusCode).toBe(403);
    expect(reason(p)).toBe("access_policy");
    expect(
      ((await sam("GET", "/v1/rewards/settings")).json() as GamificationSettings).levelSize,
    ).toBe(40);

    // another organization keeps its own settings
    const lumen = await as("iios-principal-staff-org2", LUMEN);
    expect(
      ((await lumen("GET", "/v1/rewards/settings")).json() as GamificationSettings).levelSize,
    ).toBe(100);
  });

  it("the database keeps the closed catalog and each organization apart", async () => {
    await (
      await as(SAM)
    )("POST", "/v1/rewards/settings", { levelSize: 60 });
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    const inOrg = async (org: string, q: string) => {
      await app.query("begin");
      try {
        await app.query("select set_config('app.org_id', $1, true)", [org]);
        return await app.query(q);
      } finally {
        await app.query("rollback");
      }
    };
    try {
      await expect(inOrg(NOVA, "delete from reward_rule")).rejects.toThrow(/permission denied/);
      await expect(inOrg(NOVA, "update reward_settings set org_id = org_id")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        inOrg(NOVA, "update badge_rule set threshold = 3 where kind = 'first_activity'"),
      ).rejects.toThrow(/check constraint/);
      await expect(inOrg(NOVA, "update reward_rule set xp = 500")).rejects.toThrow(
        /check constraint/,
      );
      await expect(
        inOrg(
          NOVA,
          "insert into reward_rule (org_id, kind, enabled, xp) values (ogc_current_org(), 'login_daily', true, 5)",
        ),
      ).rejects.toThrow(/check constraint/);
      expect((await inOrg(LUMEN, "select * from reward_settings")).rows).toEqual([]);
      expect((await inOrg(NOVA, "select level_size from reward_settings")).rows).toEqual([
        { level_size: 60 },
      ]);
    } finally {
      await app.end();
    }
  });
});
