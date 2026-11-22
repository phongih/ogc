/*
 * Decision Engine rule set (synthetic, per organization, kept in this browser via persist.ts).
 * Separate from the runner so the support queue can read rule settings without an import cycle.
 */
import type { Rule, RuleKind } from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";
import { refill, registerPersistent } from "./persist";

type Seed = Omit<Rule, "id">;
export const DEFAULT_RULES: Seed[] = [
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
];

// orgId → rules
const rulesByOrg = new Map<string, Rule[]>();
function seed(orgId: string): Rule[] {
  const list = DEFAULT_RULES.map((r, i) => ({
    ...r,
    params: { ...r.params },
    actions: [...r.actions],
    id: `R-${i + 1}`,
  }));
  rulesByOrg.set(orgId, list);
  return list;
}
export function rulesFor(orgId: string): Rule[] {
  const list = rulesByOrg.get(orgId);
  if (!list) return seed(orgId);
  // A save from before a rule existed (e.g. invoice_overdue, 22/11): add the missing defaults.
  DEFAULT_RULES.forEach((r, i) => {
    if (!list.some((x) => x.kind === r.kind))
      list.push({ ...r, params: { ...r.params }, actions: [...r.actions], id: `R-${i + 1}` });
  });
  return list;
}
export function resetRules(): void {
  rulesByOrg.clear();
}
/** The (enabled) rule of a kind, or null when paused. */
export function activeRule(orgId: string, kind: RuleKind): Rule | null {
  const r = rulesFor(orgId).find((x) => x.kind === kind);
  return r && r.enabled ? r : null;
}
/** Does this kind show in "Learners needing support"? (enabled AND the queue action is on) */
export function queues(orgId: string, kind: RuleKind): Rule | null {
  const r = activeRule(orgId, kind);
  return r && r.actions.includes("support_queue") ? r : null;
}
export const knownOrgs = () => organizations.map((o) => o.id);

registerPersistent("engineRules", {
  dump: () => ({ rulesByOrg }),
  load: (raw) => refill(rulesByOrg, (raw as { rulesByOrg?: unknown }).rulesByOrg),
});
