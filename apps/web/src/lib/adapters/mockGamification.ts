/*
 * Gamification — MOCK adapter (SYNTHETIC, browser memory). Owner decisions 22/11: rewards come only
 * from learning evidence, DERIVED on every read (nothing is awarded or stored by hand); XP + levels,
 * a streak of learning days, badges and a weekly class leaderboard; the learner and their guardian
 * see it; center staff tune the closed catalog. Every reward line names its evidence.
 */
import type {
  BadgeKind,
  BadgeRule,
  BadgeView,
  GamificationPort,
  GamificationSettings,
  GamificationUpdate,
  GamificationUpdateResult,
  IiosGrantedContext,
  LearnerGamification,
  RewardEvent,
  RewardKind,
  RewardRule,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { classes, rosters } from "../../fixtures/teaching";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { learningStore } from "./store";
import { makeupItems } from "./mockMakeup";
import { allows } from "./accessPolicy";
import { guardianLinksOf, learnerIdOf, staffOrgOf } from "./viewer";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

const DAY_MS = 86_400_000;
const CENTER_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh, no DST
const centerDay = (iso: string) =>
  new Date(Date.parse(iso) + CENTER_OFFSET_MS).toISOString().slice(0, 10);

export const DEFAULT_SETTINGS: GamificationSettings = {
  rules: [
    {
      kind: "activity_completed",
      name: "Activity completed",
      description: "A reading, exercise or quiz in the learner's course is completed.",
      enabled: true,
      xp: 10,
    },
    {
      kind: "practice_scored",
      name: "Practice scored",
      description:
        "Extra XP for a scored practice, in proportion to the score (this is the XP at 100%).",
      enabled: true,
      xp: 20,
    },
    {
      kind: "speaking_approved",
      name: "Speaking approved",
      description: "The teacher approved a speaking rehearsal.",
      enabled: true,
      xp: 25,
    },
    {
      kind: "makeup_done",
      name: "Make-up done",
      description: "A missed unit was made up (attended, or self-study confirmed by the teacher).",
      enabled: true,
      xp: 15,
    },
  ],
  badges: [
    {
      kind: "first_activity",
      title: "First step",
      icon: "🎯",
      how: "Complete your first activity.",
      enabled: true,
      threshold: null,
    },
    {
      kind: "perfect_score",
      title: "Perfect score",
      icon: "🏆",
      how: "Score 100% on a practice.",
      enabled: true,
      threshold: null,
    },
    {
      kind: "speaking_approved",
      title: "Heard you",
      icon: "🎤",
      how: "Have a speaking rehearsal approved by your teacher.",
      enabled: true,
      threshold: null,
    },
    {
      kind: "makeup_on_time",
      title: "Caught up",
      icon: "📅",
      how: "Make up a missed lesson before its deadline.",
      enabled: true,
      threshold: null,
    },
    {
      kind: "streak",
      title: "Learning streak",
      icon: "🔥",
      how: "Learn on this many days in a row.",
      enabled: true,
      threshold: 7,
    },
    {
      kind: "level",
      title: "Level up",
      icon: "⭐",
      how: "Reach this level.",
      enabled: true,
      threshold: 5,
    },
  ],
  levelSize: 100,
  leaderboardEnabled: true,
};

const settingsByOrg = new Map<string, GamificationSettings>();
const settingsFor = (orgId: string): GamificationSettings => {
  let s = settingsByOrg.get(orgId);
  if (!s) {
    s = structuredClone(DEFAULT_SETTINGS);
    settingsByOrg.set(orgId, s);
  }
  return s;
};
sessionStore.onReset(() => settingsByOrg.clear());
registerPersistent("gamification", {
  dump: () => ({ settingsByOrg }),
  load: (raw) => refill(settingsByOrg, (raw as { settingsByOrg?: unknown }).settingsByOrg),
});

// ── derivation ─────────────────────────────────────────────────────────────────────────────

const ruleOf = (s: GamificationSettings, k: RewardKind): RewardRule | undefined =>
  s.rules.find((r) => r.kind === k && r.enabled);

interface Derived {
  events: RewardEvent[];
  perfect: string | null;
  speaking: string | null;
  first: string | null;
  onTimeMakeup: string | null;
}

function deriveEvents(orgId: string, learnerId: string, s: GamificationSettings): Derived {
  const events: RewardEvent[] = [];
  const out: Derived = { events, perfect: null, speaking: null, first: null, onTimeMakeup: null };
  const earliest = (cur: string | null, at: string) => (!cur || at < cur ? at : cur);
  for (const a of learningStore.completionsOf(learnerId)) {
    const act = activities.find((x) => x.id === a.activityId);
    if (!act || act.orgId !== orgId) continue;
    const at = a.recordedAt;
    if (act.kind === "speaking") {
      // A speaking activity completes only when the teacher approves the rehearsal.
      out.speaking = earliest(out.speaking, at);
      const r = ruleOf(s, "speaking_approved");
      if (r)
        events.push({
          at,
          kind: r.kind,
          xp: r.xp,
          evidence: `${act.title} · approved by your teacher`,
        });
      continue;
    }
    out.first = earliest(out.first, at);
    const done = ruleOf(s, "activity_completed");
    if (done)
      events.push({ at, kind: done.kind, xp: done.xp, evidence: `${act.title} · completed` });
    if (a.score !== null) {
      if (a.score === 100) out.perfect = earliest(out.perfect, at);
      const sc = ruleOf(s, "practice_scored");
      const xp = sc ? Math.round((sc.xp * a.score) / 100) : 0;
      if (sc && xp > 0)
        events.push({ at, kind: sc.kind, xp, evidence: `${act.title} · scored ${a.score}%` });
    }
  }
  for (const m of makeupItems(orgId)) {
    if (m.learnerId !== learnerId || m.status !== "done") continue;
    const at = m.booking?.selfStudy?.confirmedAt ?? m.booking?.at ?? m.dueAt;
    if (at <= m.dueAt) out.onTimeMakeup = earliest(out.onTimeMakeup, at);
    const r = ruleOf(s, "makeup_done");
    if (r)
      events.push({
        at,
        kind: r.kind,
        xp: r.xp,
        evidence: `Made up ${m.unitTitle} (${m.className})`,
      });
  }
  events.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return out;
}

/** Consecutive learning days (center time) ending today, or yesterday if nothing yet today. */
function streakOf(events: RewardEvent[], now = Date.now()): { days: number; today: boolean } {
  const days = new Set(events.map((e) => centerDay(e.at)));
  const today = centerDay(new Date(now).toISOString());
  let cursor = days.has(today) ? now : now - DAY_MS;
  let n = 0;
  while (days.has(centerDay(new Date(cursor).toISOString()))) {
    n++;
    cursor -= DAY_MS;
  }
  return { days: n, today: days.has(today) };
}

const weeklyXpOf = (events: RewardEvent[], now = Date.now()) =>
  events.filter((e) => Date.parse(e.at) > now - 7 * DAY_MS).reduce((t, e) => t + e.xp, 0);

function classOf(orgId: string, learnerId: string) {
  return classes.find(
    (c) => c.orgId === orgId && (rosters[c.id] ?? []).some((r) => r.learnerId === learnerId),
  );
}

function view(orgId: string, learnerId: string, forGuardian: boolean): LearnerGamification {
  const s = settingsFor(orgId);
  const d = deriveEvents(orgId, learnerId, s);
  const xp = d.events.reduce((t, e) => t + e.xp, 0);
  const level = Math.floor(xp / s.levelSize) + 1;
  const streak = streakOf(d.events);
  const cls = classOf(orgId, learnerId);
  const name =
    (cls && rosters[cls.id]?.find((r) => r.learnerId === learnerId)?.displayName) ?? "Learner";

  const earnedAt: Record<BadgeKind, string | null> = {
    first_activity: d.first,
    perfect_score: d.perfect,
    speaking_approved: d.speaking,
    makeup_on_time: d.onTimeMakeup,
    streak: null,
    level: null,
  };
  const badges: BadgeView[] = s.badges
    .filter((b) => b.enabled)
    .map((b: BadgeRule) => {
      let at = earnedAt[b.kind];
      // Streak / level badges: earned while the current value reaches the threshold.
      if (b.kind === "streak" && b.threshold && streak.days >= b.threshold)
        at = d.events[0]?.at ?? null;
      if (b.kind === "level" && b.threshold && level >= b.threshold) at = d.events[0]?.at ?? null;
      const how =
        b.threshold !== null
          ? `${b.how} (${b.threshold}${b.kind === "streak" ? " days" : ""})`
          : b.how;
      return { kind: b.kind, title: b.title, how, icon: b.icon, earned: !!at, earnedAt: at };
    });

  let leaderboard: LearnerGamification["leaderboard"] = null;
  if (s.leaderboardEnabled && cls) {
    const rows = (rosters[cls.id] ?? [])
      .map((r) => ({
        learnerId: r.learnerId,
        name: r.displayName,
        weeklyXp: weeklyXpOf(deriveEvents(orgId, r.learnerId, s).events),
      }))
      .sort((a, b) => b.weeklyXp - a.weeklyXp || a.name.localeCompare(b.name));
    const ranked = rows.map((r, i) => ({
      rank: i > 0 && rows[i - 1].weeklyXp === r.weeklyXp ? -1 : i + 1,
      name: r.name,
      weeklyXp: r.weeklyXp,
      you: r.learnerId === learnerId,
    }));
    // Equal XP share a rank.
    for (let i = 0; i < ranked.length; i++)
      if (ranked[i].rank === -1) ranked[i].rank = ranked[i - 1].rank;
    leaderboard = {
      className: cls.name,
      size: ranked.length,
      yourRank: ranked.find((r) => r.you)?.rank ?? ranked.length,
      // A guardian sees their child's rank only — never classmates' names.
      top: forGuardian ? [] : ranked.slice(0, 5),
    };
  }

  return {
    learnerId,
    displayName: name,
    xp,
    level,
    xpIntoLevel: xp % s.levelSize,
    levelSize: s.levelSize,
    streakDays: streak.days,
    activeToday: streak.today,
    weeklyXp: weeklyXpOf(d.events),
    badges,
    recent: d.events.slice(0, 5),
    leaderboard,
  };
}

// ── port ──────────────────────────────────────────────────────────────────────────────────

function validate(next: GamificationSettings): string | null {
  for (const r of next.rules)
    if (!Number.isInteger(r.xp) || r.xp < 0 || r.xp > 100) return `${r.name}: XP must be 0–100`;
  for (const b of next.badges)
    if (
      b.threshold !== null &&
      (!Number.isInteger(b.threshold) || b.threshold < 1 || b.threshold > 365)
    )
      return `${b.title}: threshold must be 1–365`;
  if (!Number.isInteger(next.levelSize) || next.levelSize < 10 || next.levelSize > 1000)
    return "XP per level must be 10–1000";
  return null;
}

export const mockGamification: GamificationPort = {
  getMine: (viewer: IiosGrantedContext) =>
    withFault("gamification.getMine", () => {
      const own = learnerIdOf(viewer);
      if (own) return latency([view(viewer.orgId, own, false)]);
      const linked = guardianLinksOf(viewer);
      return latency(linked.map((id) => view(viewer.orgId, id, true)));
    }),

  getSettings: (viewer) =>
    withFault("gamification.getSettings", () => {
      const org = staffOrgOf(viewer);
      return latency(org ? structuredClone(settingsFor(org)) : null);
    }),

  updateSettings: (viewer, patch: GamificationUpdate) =>
    withFault("gamification.updateSettings", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<GamificationUpdateResult>({ ok: false, reason: "not_staff" });
      if (!allows(viewer, "rewards:manage"))
        return latency<GamificationUpdateResult>({ ok: false, reason: "access_policy" });
      const next = structuredClone(settingsFor(org));
      for (const p of patch.rules ?? []) {
        const r = next.rules.find((x) => x.kind === p.kind);
        if (!r)
          return latency<GamificationUpdateResult>({
            ok: false,
            reason: "invalid",
            detail: `unknown reward ${p.kind}`,
          });
        if (p.enabled !== undefined) r.enabled = p.enabled;
        if (p.xp !== undefined) r.xp = p.xp;
      }
      for (const p of patch.badges ?? []) {
        const b = next.badges.find((x) => x.kind === p.kind);
        if (!b)
          return latency<GamificationUpdateResult>({
            ok: false,
            reason: "invalid",
            detail: `unknown badge ${p.kind}`,
          });
        if (p.enabled !== undefined) b.enabled = p.enabled;
        if (p.threshold !== undefined && b.threshold !== null) b.threshold = p.threshold;
      }
      if (patch.levelSize !== undefined) next.levelSize = patch.levelSize;
      if (patch.leaderboardEnabled !== undefined)
        next.leaderboardEnabled = patch.leaderboardEnabled;
      const bad = validate(next);
      if (bad)
        return latency<GamificationUpdateResult>({ ok: false, reason: "invalid", detail: bad });
      settingsByOrg.set(org, next);
      return latency<GamificationUpdateResult>({ ok: true, settings: structuredClone(next) });
    }),
};
