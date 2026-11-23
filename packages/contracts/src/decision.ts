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
  "invoice_overdue",
  "studio_inactive",
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
  invoice_overdue: { days: { label: "days overdue, at least", min: 1, max: 120 } },
  studio_inactive: { days: { label: "days without class course activity", min: 3, max: 60 } },
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
  type: z.enum(["learner", "session", "teacher", "class", "makeup", "invoice"]),
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

/** The fixed rule set every organization starts with (ids R-1… in this order). */
export const DEFAULT_ENGINE_RULES: Omit<Rule, "id">[] = [
  {
    kind: "skill_drop",
    category: "learning",
    name: "Skill dropped after practice",
    description: "The latest practice lowered a skill by at least this much.",
    enabled: true,
    priority: "P1",
    cooldownMin: 120,
    params: { drop: 5 },
    actions: ["support_queue", "notify_teacher"],
  },
  {
    kind: "skill_low",
    category: "learning",
    name: "Skill below threshold",
    description: "A skill level is below the threshold (placement or practice).",
    enabled: true,
    priority: "P2",
    cooldownMin: 1440,
    params: { threshold: 60 },
    actions: ["support_queue"],
  },
  {
    kind: "speaking_returned",
    category: "learning",
    name: "Speaking returned for another try",
    description: "The teacher sent a speaking rehearsal back.",
    enabled: true,
    priority: "P3",
    cooldownMin: 1440,
    params: {},
    actions: ["support_queue"],
  },
  {
    kind: "absence_streak",
    category: "attendance",
    name: "Absent several sessions in a row",
    description: "Absent from the latest marked sessions of their own class.",
    enabled: true,
    priority: "P1",
    cooldownMin: 1440,
    params: { sessions: 2 },
    actions: ["support_queue", "notify_teacher"],
  },
  {
    kind: "makeup_due_soon",
    category: "attendance",
    name: "Make-up deadline close",
    description: "A missed unit is not made up and its 14-day deadline is near.",
    enabled: true,
    priority: "P2",
    cooldownMin: 1440,
    params: { days: 3 },
    actions: ["notify_staff"],
  },
  {
    kind: "makeup_overdue",
    category: "attendance",
    name: "Make-up overdue",
    description: "A missed unit is past its 14-day deadline.",
    enabled: true,
    priority: "P1",
    cooldownMin: 1440,
    params: {},
    actions: ["notify_staff", "notify_teacher"],
  },
  {
    kind: "makeup_missed_again",
    category: "attendance",
    name: "Absent from the make-up too",
    description: "The learner missed the make-up that was booked.",
    enabled: true,
    priority: "P1",
    cooldownMin: 1440,
    params: {},
    actions: ["notify_staff"],
  },
  {
    kind: "session_unmarked",
    category: "operations",
    name: "Attendance not taken",
    description: "A session started this long ago and is still not marked.",
    enabled: true,
    priority: "P1",
    cooldownMin: 1440,
    params: { hours: 24 },
    actions: ["notify_teacher", "notify_staff"],
  },
  {
    kind: "teacher_overload",
    category: "operations",
    name: "Teacher load high",
    description: "A teacher has more sessions in the next 7 days than this.",
    enabled: true,
    priority: "P2",
    cooldownMin: 4320,
    params: { sessionsPerWeek: 8 },
    actions: ["notify_staff"],
  },
  {
    kind: "class_without_teacher",
    category: "operations",
    name: "Class without a teacher",
    description: "A class has no class teacher assigned.",
    enabled: true,
    priority: "P1",
    cooldownMin: 1440,
    params: {},
    actions: ["notify_staff"],
  },
  {
    kind: "no_practice",
    category: "engagement",
    name: "No practice lately",
    description: "A learner has not practised for this many days.",
    enabled: false,
    priority: "P3",
    cooldownMin: 4320,
    params: { days: 7 },
    actions: ["log_only"],
  },
  {
    kind: "invoice_overdue",
    category: "operations",
    name: "Invoice overdue",
    description:
      "An invoice is unpaid this many days after its due date. Staff are told; learning is never blocked.",
    enabled: true,
    priority: "P2",
    cooldownMin: 1440,
    params: { days: 7 },
    actions: ["notify_staff"],
  },
  {
    kind: "studio_inactive",
    category: "engagement",
    name: "No class course activity",
    description:
      "A learner of a class linked to a course has not completed a lesson of it for this many days (completion only).",
    enabled: false,
    priority: "P3",
    cooldownMin: 4320,
    params: { days: 14 },
    actions: ["notify_teacher"],
  },
];
