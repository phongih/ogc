import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Gamification — ADDITIVE, SYNTHETIC, mock only. Owner decisions (22/11):
 *  - rewards come ONLY from learning evidence (principle 03): a completed activity, a scored
 *    practice, a speaking rehearsal the teacher approved, a make-up done. Never from logging in or
 *    time in the app. Everything is DERIVED from that evidence on read — nothing is awarded by hand;
 *  - XP + levels, a streak of learning days, badges, and a weekly class leaderboard;
 *  - the learner and their guardian see it (a guardian sees their child's rank, not classmates'
 *    names); teachers keep seeing learning evidence only;
 *  - center staff tune the closed catalog (enable / XP / badge thresholds / leaderboard on-off),
 *    as with the Decision Engine — no free-form rules.
 * Every reward line names the evidence it rests on.
 */

export const RewardKind = z.enum([
  "activity_completed",
  "practice_scored",
  "speaking_approved",
  "makeup_done",
  "mission_approved",
]);
export type RewardKind = z.infer<typeof RewardKind>;

export const BadgeKind = z.enum([
  "first_activity",
  "perfect_score",
  "speaking_approved",
  "makeup_on_time",
  "streak",
  "level",
  "explorer",
]);
export type BadgeKind = z.infer<typeof BadgeKind>;

export const RewardRule = z.object({
  kind: RewardKind,
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  xp: z.number().int().min(0).max(100), // practice_scored: XP for a 100% score, scaled by score
});
export type RewardRule = z.infer<typeof RewardRule>;

export const BadgeRule = z.object({
  kind: BadgeKind,
  title: z.string(),
  how: z.string(), // how to earn it, in plain words
  icon: z.string(),
  enabled: z.boolean(),
  threshold: z.number().int().min(1).max(365).nullable(), // streak days / level; null otherwise
});
export type BadgeRule = z.infer<typeof BadgeRule>;

export const GamificationSettings = z.object({
  rules: z.array(RewardRule),
  badges: z.array(BadgeRule),
  levelSize: z.number().int().min(10).max(1000), // XP per level
  leaderboardEnabled: z.boolean(),
});
export type GamificationSettings = z.infer<typeof GamificationSettings>;

export interface RewardEvent {
  at: string;
  kind: RewardKind;
  xp: number;
  evidence: string; // e.g. "Quiz: At the market · scored 75%"
}

export interface BadgeView {
  kind: BadgeKind;
  title: string;
  how: string;
  icon: string;
  earned: boolean;
  earnedAt: string | null;
}

export interface LeaderboardRow {
  rank: number;
  name: string;
  weeklyXp: number;
  you: boolean;
}

export interface LearnerGamification {
  learnerId: string;
  displayName: string;
  xp: number;
  level: number;
  xpIntoLevel: number;
  levelSize: number;
  streakDays: number;
  activeToday: boolean; // evidence recorded today (center time)
  weeklyXp: number; // last 7 days
  badges: BadgeView[];
  recent: RewardEvent[]; // newest first, up to 5
  // null when the leaderboard is off or the learner has no class.
  leaderboard: {
    className: string;
    size: number;
    yourRank: number;
    top: LeaderboardRow[]; // empty for a guardian (no classmates' names)
  } | null;
}

export type GamificationUpdate = Partial<{
  rules: { kind: RewardKind; enabled?: boolean; xp?: number }[];
  badges: { kind: BadgeKind; enabled?: boolean; threshold?: number | null }[];
  levelSize: number;
  leaderboardEnabled: boolean;
}>;

export type GamificationUpdateResult =
  | { ok: true; settings: GamificationSettings }
  | { ok: false; reason: "not_staff" | "invalid" | "access_policy"; detail?: string };

export interface GamificationPort {
  // Learner: their own. Guardian: each linked learner (D-14 links only). Everyone else: [].
  getMine(viewer: IiosGrantedContext): Promise<LearnerGamification[]>;
  // Center staff of the organization (fail-closed: null / not_staff).
  getSettings(viewer: IiosGrantedContext): Promise<GamificationSettings | null>;
  updateSettings(
    viewer: IiosGrantedContext,
    patch: GamificationUpdate,
  ): Promise<GamificationUpdateResult>;
}

// ── shared derivation (owner 24/11: the demo and the Platform API use the same rules) ─────────

export const DEFAULT_GAMIFICATION: GamificationSettings = {
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
    {
      kind: "mission_approved",
      name: "Mission approved",
      description: "The class teacher approved a real-world mission (Mission Box).",
      enabled: true,
      xp: 20,
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
    {
      kind: "explorer",
      title: "Explorer",
      icon: "🧭",
      how: "Have a real-world mission approved by your teacher.",
      enabled: true,
      threshold: null,
    },
  ],
  levelSize: 100,
  leaderboardEnabled: true,
};

/** One piece of learning evidence, as the rewards read it (never a login, never time in app). */
export type RewardEvidence =
  // score: the quiz % (also skill evidence); practice: the practice / mini-game % (XP only)
  | { kind: "activity"; at: string; title: string; score: number | null; practice?: number | null }
  | { kind: "speaking"; at: string; title: string }
  | { kind: "mission"; at: string; title: string } // approved by the class teacher (XP only)
  | { kind: "makeup"; at: string; dueAt: string; unitTitle: string; className: string };

export interface DerivedRewards {
  events: RewardEvent[]; // newest first
  first: string | null;
  perfect: string | null;
  speaking: string | null;
  onTimeMakeup: string | null;
  mission: string | null;
}

const DAY_MS = 86_400_000;
const CENTER_OFFSET_MS = 7 * 3_600_000; // Asia/Ho_Chi_Minh, no DST
export const centerDayOf = (iso: string) =>
  new Date(Date.parse(iso) + CENTER_OFFSET_MS).toISOString().slice(0, 10);

const ruleOn = (s: GamificationSettings, k: RewardKind) =>
  s.rules.find((r) => r.kind === k && r.enabled);
const earliest = (cur: string | null, at: string) => (!cur || at < cur ? at : cur);

/** Reward lines from evidence, each naming the evidence it rests on. */
export function deriveRewards(
  evidence: readonly RewardEvidence[],
  s: GamificationSettings,
): DerivedRewards {
  const events: RewardEvent[] = [];
  const out: DerivedRewards = {
    events,
    first: null,
    perfect: null,
    speaking: null,
    onTimeMakeup: null,
    mission: null,
  };
  for (const e of evidence) {
    if (e.kind === "speaking") {
      out.speaking = earliest(out.speaking, e.at);
      const r = ruleOn(s, "speaking_approved");
      if (r)
        events.push({
          at: e.at,
          kind: r.kind,
          xp: r.xp,
          evidence: `${e.title} · approved by your teacher`,
        });
    } else if (e.kind === "mission") {
      out.mission = earliest(out.mission, e.at);
      const r = ruleOn(s, "mission_approved");
      if (r)
        events.push({
          at: e.at,
          kind: r.kind,
          xp: r.xp,
          evidence: `Mission: ${e.title} · approved by your teacher`,
        });
    } else if (e.kind === "activity") {
      out.first = earliest(out.first, e.at);
      const done = ruleOn(s, "activity_completed");
      if (done)
        events.push({ at: e.at, kind: done.kind, xp: done.xp, evidence: `${e.title} · completed` });
      for (const [pct, what] of [
        [e.score, "scored"],
        [e.practice ?? null, "practice"],
      ] as const) {
        if (pct === null) continue;
        if (pct === 100) out.perfect = earliest(out.perfect, e.at);
        const sc = ruleOn(s, "practice_scored");
        const xp = sc ? Math.round((sc.xp * pct) / 100) : 0;
        if (sc && xp > 0)
          events.push({ at: e.at, kind: sc.kind, xp, evidence: `${e.title} · ${what} ${pct}%` });
      }
    } else {
      if (e.at <= e.dueAt) out.onTimeMakeup = earliest(out.onTimeMakeup, e.at);
      const r = ruleOn(s, "makeup_done");
      if (r)
        events.push({
          at: e.at,
          kind: r.kind,
          xp: r.xp,
          evidence: `Made up ${e.unitTitle} (${e.className})`,
        });
    }
  }
  events.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return out;
}

/** Consecutive learning days (center time) ending today, or yesterday if nothing yet today. */
export function streakOf(events: readonly RewardEvent[], now: number) {
  const days = new Set(events.map((e) => centerDayOf(e.at)));
  const today = centerDayOf(new Date(now).toISOString());
  let cursor = days.has(today) ? now : now - DAY_MS;
  let n = 0;
  while (days.has(centerDayOf(new Date(cursor).toISOString()))) {
    n++;
    cursor -= DAY_MS;
  }
  return { days: n, today: days.has(today) };
}

export const weeklyXpOf = (events: readonly RewardEvent[], now: number) =>
  events.filter((e) => Date.parse(e.at) > now - 7 * DAY_MS).reduce((t, e) => t + e.xp, 0);

/** Weekly class ranking; equal XP share a rank; ties ordered by name. */
export function rankClass(
  rows: readonly { learnerId: string; name: string; weeklyXp: number }[],
  you: string,
): LeaderboardRow[] {
  const sorted = [...rows].sort((a, b) => b.weeklyXp - a.weeklyXp || a.name.localeCompare(b.name));
  const out: LeaderboardRow[] = [];
  sorted.forEach((r, i) =>
    out.push({
      rank: i > 0 && sorted[i - 1]!.weeklyXp === r.weeklyXp ? out[i - 1]!.rank : i + 1,
      name: r.name,
      weeklyXp: r.weeklyXp,
      you: r.learnerId === you,
    }),
  );
  return out;
}

/** A learner's rewards view. `classmates` is null when the learner has no class. */
export function gamificationView(input: {
  learnerId: string;
  displayName: string;
  evidence: readonly RewardEvidence[];
  settings: GamificationSettings;
  now: number;
  forGuardian: boolean;
  klass: { name: string; members: { learnerId: string; name: string; weeklyXp: number }[] } | null;
}): LearnerGamification {
  const s = input.settings;
  const d = deriveRewards(input.evidence, s);
  const xp = d.events.reduce((t, e) => t + e.xp, 0);
  const level = Math.floor(xp / s.levelSize) + 1;
  const streak = streakOf(d.events, input.now);
  const earnedAt: Record<BadgeKind, string | null> = {
    first_activity: d.first,
    perfect_score: d.perfect,
    speaking_approved: d.speaking,
    makeup_on_time: d.onTimeMakeup,
    streak: null,
    level: null,
    explorer: d.mission,
  };
  const badges: BadgeView[] = s.badges
    .filter((b) => b.enabled)
    .map((b) => {
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
  if (s.leaderboardEnabled && input.klass) {
    const ranked = rankClass(input.klass.members, input.learnerId);
    leaderboard = {
      className: input.klass.name,
      size: ranked.length,
      yourRank: ranked.find((r) => r.you)?.rank ?? ranked.length,
      // A guardian sees their child's rank only — never classmates' names.
      top: input.forGuardian ? [] : ranked.slice(0, 5),
    };
  }
  return {
    learnerId: input.learnerId,
    displayName: input.displayName,
    xp,
    level,
    xpIntoLevel: xp % s.levelSize,
    levelSize: s.levelSize,
    streakDays: streak.days,
    activeToday: streak.today,
    weeklyXp: weeklyXpOf(d.events, input.now),
    badges,
    recent: d.events.slice(0, 5),
    leaderboard,
  };
}

/** Apply a staff change within the closed catalog; unknown kinds or out-of-range values refused. */
export function applyGamificationUpdate(
  current: GamificationSettings,
  patch: GamificationUpdate,
): { ok: true; settings: GamificationSettings } | { ok: false; detail: string } {
  const next: GamificationSettings = JSON.parse(JSON.stringify(current));
  for (const p of patch.rules ?? []) {
    const r = next.rules.find((x) => x.kind === p.kind);
    if (!r) return { ok: false, detail: `unknown reward ${String(p.kind)}` };
    if (p.enabled !== undefined) r.enabled = p.enabled;
    if (p.xp !== undefined) r.xp = p.xp;
  }
  for (const p of patch.badges ?? []) {
    const b = next.badges.find((x) => x.kind === p.kind);
    if (!b) return { ok: false, detail: `unknown badge ${String(p.kind)}` };
    if (p.enabled !== undefined) b.enabled = p.enabled;
    if (p.threshold !== undefined && b.threshold !== null) b.threshold = p.threshold;
  }
  if (patch.levelSize !== undefined) next.levelSize = patch.levelSize;
  if (patch.leaderboardEnabled !== undefined) next.leaderboardEnabled = patch.leaderboardEnabled;
  for (const r of next.rules)
    if (typeof r.enabled !== "boolean" || !Number.isInteger(r.xp) || r.xp < 0 || r.xp > 100)
      return { ok: false, detail: `${r.name}: XP must be 0–100` };
  for (const b of next.badges)
    if (
      typeof b.enabled !== "boolean" ||
      (b.threshold !== null &&
        (!Number.isInteger(b.threshold) || b.threshold < 1 || b.threshold > 365))
    )
      return { ok: false, detail: `${b.title}: threshold must be 1–365` };
  if (!Number.isInteger(next.levelSize) || next.levelSize < 10 || next.levelSize > 1000)
    return { ok: false, detail: "XP per level must be 10–1000" };
  if (typeof next.leaderboardEnabled !== "boolean")
    return { ok: false, detail: "the leaderboard is on or off" };
  return { ok: true, settings: next };
}
