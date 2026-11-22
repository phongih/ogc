import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Decision Engine — Observe → Detect → Decide → Act. ADDITIVE, SYNTHETIC, mock only.
 *
 * Owner decisions (21/11):
 *  - actions are LIMITED to: write a log entry, notify a teacher or center staff in the app, and
 *    show the case in an existing queue ("Learners needing support"). The engine never assigns
 *    work, changes a score or moves a lesson — people do that;
 *  - center STAFF manage rules: enable / pause, thresholds, priority, cooldown, which actions.
 *    No free-form rule builder yet;
 *  - first rule set: learning, attendance + make-up, operations, engagement.
 * Every event states the evidence it rests on, in plain words.
 */

export const RuleCategory = z.enum(["learning", "attendance", "operations", "engagement"]);
export type RuleCategory = z.infer<typeof RuleCategory>;

export const RuleKind = z.enum([
  "skill_low",
  "skill_drop",
  "speaking_returned",
  "absence_streak",
  "makeup_due_soon",
  "makeup_overdue",
  "makeup_missed_again",
  "session_unmarked",
  "teacher_overload",
  "class_without_teacher",
  "no_practice",
]);
export type RuleKind = z.infer<typeof RuleKind>;

export const RuleAction = z.enum(["log_only", "notify_teacher", "notify_staff", "support_queue"]);
export type RuleAction = z.infer<typeof RuleAction>;

export const Priority = z.enum(["P1", "P2", "P3"]);
export type Priority = z.infer<typeof Priority>;

// Tunable numbers per kind, with the allowed range (staff edit these).
export const RULE_PARAMS: Record<
  RuleKind,
  Record<string, { label: string; min: number; max: number }>
> = {
  skill_low: { threshold: { label: "skill below", min: 1, max: 100 } },
  skill_drop: { drop: { label: "drop of at least", min: 1, max: 50 } },
  speaking_returned: {},
  absence_streak: { sessions: { label: "absent sessions in a row", min: 1, max: 10 } },
  makeup_due_soon: { days: { label: "days before the deadline", min: 1, max: 13 } },
  makeup_overdue: {},
  makeup_missed_again: {},
  session_unmarked: { hours: { label: "hours after start", min: 1, max: 168 } },
  teacher_overload: {
    sessionsPerWeek: { label: "sessions in the next 7 days, more than", min: 1, max: 40 },
  },
  class_without_teacher: {},
  no_practice: { days: { label: "days without practice", min: 1, max: 60 } },
};

// Only learner cases can go to the support queue.
export const QUEUE_KINDS: readonly RuleKind[] = [
  "skill_low",
  "skill_drop",
  "speaking_returned",
  "absence_streak",
];

export const Rule = z.object({
  id: z.string(),
  kind: RuleKind,
  category: RuleCategory,
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  priority: Priority,
  cooldownMin: z.number().int().min(0).max(10080),
  params: z.record(z.number()),
  actions: z.array(RuleAction).min(1),
});
export type Rule = z.infer<typeof Rule>;

export const RuleUpdate = Rule.pick({
  enabled: true,
  priority: true,
  cooldownMin: true,
  params: true,
  actions: true,
}).partial();
export type RuleUpdate = z.infer<typeof RuleUpdate>;

export const EngineSubject = z.object({
  type: z.enum(["learner", "session", "teacher", "class", "makeup"]),
  id: z.string(),
  label: z.string(),
});

export const EngineEvent = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  kind: RuleKind,
  priority: Priority,
  at: z.string(),
  subject: EngineSubject,
  evidence: z.string(), // plain words: what the data shows
});
export type EngineEvent = z.infer<typeof EngineEvent>;

export const ActionLogEntry = z.object({
  id: z.string(),
  eventId: z.string(),
  ruleName: z.string(),
  action: RuleAction,
  target: z.string(), // "Tara", "center staff", "Learners needing support", "log"
  at: z.string(),
});
export type ActionLogEntry = z.infer<typeof ActionLogEntry>;

export const JobStatus = z.object({
  runs: z.number().int(),
  lastRunAt: z.string().nullable(),
  lastDurationMs: z.number().nullable(),
  lastDetected: z.number().int(), // conditions true at the last run
  lastNewEvents: z.number().int(),
  lastSkippedCooldown: z.number().int(),
  intervalSec: z.number().int(), // the job runs when a page asks and the last run is older than this
});
export type JobStatus = z.infer<typeof JobStatus>;

export const EngineNotification = z.object({
  id: z.string(),
  eventId: z.string(),
  priority: Priority,
  text: z.string(),
  at: z.string(),
  read: z.boolean(),
});
export type EngineNotification = z.infer<typeof EngineNotification>;

export const RuleUpdateResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), rule: Rule }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["not_staff", "not_found", "invalid", "access_policy"]),
    detail: z.string().optional(),
  }),
]);
export type RuleUpdateResult = z.infer<typeof RuleUpdateResult>;

export interface DecisionEnginePort {
  // Staff of the organization (fail-closed: null / [] / not_staff).
  listRules(viewer: IiosGrantedContext): Promise<Rule[] | null>;
  updateRule(
    viewer: IiosGrantedContext,
    ruleId: string,
    patch: RuleUpdate,
  ): Promise<RuleUpdateResult>;
  runNow(viewer: IiosGrantedContext): Promise<JobStatus | null>;
  listEvents(viewer: IiosGrantedContext): Promise<EngineEvent[]>;
  listActions(viewer: IiosGrantedContext): Promise<ActionLogEntry[]>;
  getJobStatus(viewer: IiosGrantedContext): Promise<JobStatus | null>;
  // Teacher or staff: their own in-app notifications.
  listNotifications(viewer: IiosGrantedContext): Promise<EngineNotification[]>;
  markRead(viewer: IiosGrantedContext, notificationId: string | "all"): Promise<void>;
}
