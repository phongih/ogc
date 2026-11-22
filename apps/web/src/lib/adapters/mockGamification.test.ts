// Gamification (owner 22/11): rewards derived from learning evidence only; XP + level, streak of
// learning days, badges, weekly class leaderboard; learner + guardian see it; staff tune the
// closed catalog. One module = one fresh store.
import { afterEach, describe, expect, it, vi } from "vitest";
import { as } from "../../test/grants";
import { mockGamification as G } from "./mockGamification";
import { mockPractice as practice } from "./mockPractice";
import { __attachForTests } from "../integration/mockIiosPolicy";

const L = "demo-learner"; // Linh
const correctA23 = {
  attemptId: "ATT-GAME-A23",
  responses: [
    { itemId: "A2-3-Q1", optionId: "a" },
    { itemId: "A2-3-Q2", optionId: "b" },
    { itemId: "A2-3-Q3", optionId: "b" },
    { itemId: "A2-3-Q4", optionId: "a" },
  ],
};
const linh = async () => (await G.getMine(as(L)))[0];

afterEach(() => vi.useRealTimers());

describe("gamification — who sees what", () => {
  it("a learner sees their own; a guardian sees the linked child with a rank but no names", async () => {
    const mine = await G.getMine(as(L));
    expect(mine).toHaveLength(1);
    expect(mine[0].displayName).toBe("Linh N.");
    const g = await G.getMine(as("demo-guardian"));
    expect(g.map((x) => x.displayName)).toEqual(["Linh N."]);
    expect(g[0].leaderboard!.top).toEqual([]); // no classmates' names for a guardian
    expect(g[0].leaderboard!.yourRank).toBeGreaterThan(0);
  });

  it("teachers and staff get nothing; a learner in another tenant sees only themselves", async () => {
    for (const p of ["demo-teacher", "demo-staff", "demo-admin"])
      expect(await G.getMine(as(p))).toEqual([]);
    const other = await G.getMine(as("demo-learner-org2"));
    expect(other).toHaveLength(1);
    expect(other[0].displayName).not.toBe("Linh N.");
    expect(other[0].xp).toBe(0); // Linh's evidence never counts in another tenant
  });
});

describe("gamification — derived from evidence only", () => {
  it("seeded completions give XP and a first badge, but no streak (they are weeks old)", async () => {
    const g = await linh();
    expect(g.xp).toBeGreaterThan(0);
    expect(g.level).toBe(Math.floor(g.xp / 100) + 1);
    expect(g.streakDays).toBe(0);
    expect(g.weeklyXp).toBe(0);
    expect(g.badges.find((b) => b.kind === "first_activity")!.earned).toBe(true);
    expect(g.badges.find((b) => b.kind === "speaking_approved")!.earned).toBe(false);
    // Every reward names its evidence.
    expect(g.recent.every((e) => e.evidence.length > 0 && e.xp > 0)).toBe(true);
  });

  it("a scored practice today starts a streak, adds weekly XP and tops the class board", async () => {
    const before = await linh();
    const r = await practice.submitPractice(as(L), "ACT-A2-3", correctA23);
    expect(r.ok).toBe(true);
    const g = await linh();
    expect(g.streakDays).toBe(1);
    expect(g.activeToday).toBe(true);
    // 10 for completing + 20 × score% for the score (all correct → 100%).
    expect(g.xp - before.xp).toBe(30);
    expect(g.weeklyXp).toBe(30);
    expect(g.recent[0].evidence).toMatch(/Quiz: At the market · (scored 100%|completed)/);
    expect(g.badges.find((b) => b.kind === "perfect_score")!.earned).toBe(true);
    expect(g.leaderboard!.top[0]).toMatchObject({ rank: 1, name: "Linh N.", you: true });
    expect(g.leaderboard!.yourRank).toBe(1);
  });

  it("the streak breaks after a day without evidence and counts yesterday until today's work", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 24 * 3600 * 1000); // tomorrow, nothing done yet
    let g = await linh();
    expect(g.streakDays).toBe(1);
    expect(g.activeToday).toBe(false);
    vi.setSystemTime(Date.now() + 24 * 3600 * 1000); // the day after: a day was missed
    g = await linh();
    expect(g.streakDays).toBe(0);
  });
});

describe("gamification — staff tune the closed catalog", () => {
  it("staff change XP, switch rewards and the leaderboard; it shows at once", async () => {
    const before = await linh();
    const r = await G.updateSettings(as("demo-staff"), {
      rules: [{ kind: "practice_scored", enabled: false }],
      leaderboardEnabled: false,
    });
    expect(r.ok).toBe(true);
    const g = await linh();
    expect(g.xp).toBeLessThan(before.xp);
    expect(g.leaderboard).toBeNull();
    await G.updateSettings(as("demo-staff"), {
      rules: [{ kind: "practice_scored", enabled: true }],
      leaderboardEnabled: true,
    });
    expect((await linh()).xp).toBe(before.xp);
  });

  it("refuses bad values, non-staff, and staff whose access policy leaves out rewards", async () => {
    expect(
      await G.updateSettings(as("demo-staff"), { rules: [{ kind: "makeup_done", xp: 500 }] }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(await G.updateSettings(as("demo-teacher"), { leaderboardEnabled: false })).toEqual({
      ok: false,
      reason: "not_staff",
    });
    expect(await G.getSettings(as(L))).toBeNull();
    __attachForTests("iios-principal-staff-1", "policy-front-desk-d1"); // no rewards:manage
    expect(await G.updateSettings(as("demo-staff"), { leaderboardEnabled: false })).toEqual({
      ok: false,
      reason: "access_policy",
    });
    __attachForTests("iios-principal-staff-1", null);
  });
});
