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
]);
export type RewardKind = z.infer<typeof RewardKind>;

export const BadgeKind = z.enum([
  "first_activity",
  "perfect_score",
  "speaking_approved",
  "makeup_on_time",
  "streak",
  "level",
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
