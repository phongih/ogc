import type {
  ActionLogEntry,
  DecisionEnginePort,
  EngineEvent,
  EngineNotification,
  JobStatus,
  Rule,
  RuleUpdateResult,
} from "@ogc/contracts";
import { QUEUE_KINDS, RULE_PARAMS } from "@ogc/contracts";
import { personaMap, teacherName } from "../../fixtures/personas";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { formatCenterDate, formatCenterDateTime } from "../centerTime";
import { sessionStore } from "./sessionStore";
import { isMarked } from "./mockAttendance";
import { makeupItems } from "./mockMakeup";
import { learnerSignals } from "./mockProfile";
import { teacherOfSession } from "./clashes";
import { learningStore } from "./store";
import { rulesFor, resetRules } from "./engineRules";
import { refill, registerPersistent } from "./persist";
import { skillLabel } from "../../features/learning/intelligence/skills";
import { withFault } from "./faults";
import { decide } from "./accessPolicy";

/*
 * Decision Engine — MOCK runner. NON-PRODUCTION, synthetic, kept in this browser.
 * Observe (read the live mock stores) → Detect (each enabled rule's condition) → Decide
 * (cooldown per rule + subject) → Act (log, in-app notify teacher / staff; the support queue
 * reads the rules directly). Owner, 21/11: the engine never assigns, scores or reschedules.
 */

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
export const JOB_INTERVAL_SEC = 60;
const CAP = 300;

interface Detection {
  rule: Rule;
  key: string; // dedupe / cooldown key per subject
  subject: EngineEvent["subject"];
  evidence: string;
  teacherIds: string[]; // who "notify_teacher" reaches
}

interface OrgLog {
  events: EngineEvent[];
  actions: ActionLogEntry[];
  lastFired: Map<string, number>; // `${ruleId}|${key}` → ms
  job: JobStatus;
}
const logs = new Map<string, OrgLog>();
// recipient → notifications. Recipient: `teacher:<id>` or `staff:<orgId>`.
const inbox = new Map<string, EngineNotification[]>();
let seq = 0;

const emptyJob = (): JobStatus => ({
  runs: 0,
  lastRunAt: null,
  lastDurationMs: null,
  lastDetected: 0,
  lastNewEvents: 0,
  lastSkippedCooldown: 0,
  intervalSec: JOB_INTERVAL_SEC,
});
function logFor(orgId: string): OrgLog {
  let l = logs.get(orgId);
  if (!l) {
    l = { events: [], actions: [], lastFired: new Map(), job: emptyJob() };
    logs.set(orgId, l);
  }
  return l;
}

export function resetEngine(): void {
  logs.clear();
  inbox.clear();
  seq = 0;
  resetRules();
}
sessionStore.onReset(resetEngine);

const orgClasses = (orgId: string) => classes.filter((c) => c.orgId === orgId);
const className = (id: string) => classes.find((c) => c.id === id)?.name ?? "a class";

// ── Observe + Detect ─────────────────────────────────────────────────────────────────────────
function detect(orgId: string, now: number): Detection[] {
  const rules = rulesFor(orgId).filter((r) => r.enabled);
  const byKind = new Map(rules.map((r) => [r.kind, r]));
  const out: Detection[] = [];
  const cls = orgClasses(orgId);

  // Learners (own classes): learning + absence signals, under the engine's rules.
  const seen = new Set<string>();
  for (const c of cls)
    for (const row of rosters[c.id] ?? []) {
      if (seen.has(row.learnerId)) continue;
      seen.add(row.learnerId);
      const own = cls.filter((x) =>
        (rosters[x.id] ?? []).some((r) => r.learnerId === row.learnerId),
      );
      const teachers = [...new Set(own.map((x) => classTeachers[x.id]).filter(Boolean))];
      const subject = {
        type: "learner" as const,
        id: row.learnerId,
        label: `${row.displayName} · ${className(own[0].id)}`,
      };
      for (const s of learnerSignals(
        row.learnerId,
        orgId,
        own.map((x) => x.id),
        "engine",
      )) {
        const kind =
          s.kind === "low_skill"
            ? "skill_low"
            : s.kind === "skill_drop"
              ? "skill_drop"
              : s.kind === "speaking_returned"
                ? "speaking_returned"
                : "absence_streak";
        const rule = byKind.get(kind);
        if (!rule) continue;
        const skill = s.skill ? skillLabel(s.skill) : "";
        const evidence =
          s.kind === "low_skill"
            ? `${skill} is ${s.level}, below ${s.threshold} (${s.source === "placement" ? "placement test only" : "from practice"})`
            : s.kind === "skill_drop"
              ? `${skill} dropped ${Math.abs(s.delta ?? 0)} to ${s.level} after the latest practice`
              : s.kind === "speaking_returned"
                ? "Speaking rehearsal returned by the teacher"
                : `Absent from the last ${s.sessions} marked sessions`;
        out.push({
          rule,
          key: `${row.learnerId}|${s.skill ?? ""}`,
          subject,
          evidence,
          teacherIds: teachers,
        });
      }
      // Engagement: no practice for N days (last evidence time).
      const np = byKind.get("no_practice");
      if (np) {
        const last = learningStore.lastEvidenceAt(row.learnerId);
        const days = last ? Math.floor((now - Date.parse(last)) / 86_400_000) : null;
        if (days === null || days >= np.params.days)
          out.push({
            rule: np,
            key: row.learnerId,
            subject,
            evidence: last
              ? `No practice for ${days} days (last ${formatCenterDate(last)})`
              : "No practice recorded yet",
            teacherIds: teachers,
          });
      }
    }

  // Make-ups.
  const due = byKind.get("makeup_due_soon");
  const over = byKind.get("makeup_overdue");
  const again = byKind.get("makeup_missed_again");
  for (const i of makeupItems(orgId, now)) {
    if (i.status === "done") continue;
    const subject = {
      type: "makeup" as const,
      id: i.id,
      label: `${i.learnerName} · ${i.unitTitle}`,
    };
    const teachers = [classTeachers[i.classId]].filter(Boolean);
    const left = Math.ceil((Date.parse(i.dueAt) - now) / 86_400_000);
    if (over && i.overdue)
      out.push({
        rule: over,
        key: i.id,
        subject,
        evidence: `Not made up; deadline ${formatCenterDate(i.dueAt)} has passed`,
        teacherIds: teachers,
      });
    else if (due && left <= due.params.days)
      out.push({
        rule: due,
        key: i.id,
        subject,
        evidence: `Not made up; ${left} day${left === 1 ? "" : "s"} left (due ${formatCenterDate(i.dueAt)})`,
        teacherIds: teachers,
      });
    if (again && i.missedMakeup)
      out.push({
        rule: again,
        key: i.id,
        subject,
        evidence: "Absent from the booked make-up as well",
        teacherIds: teachers,
      });
  }

  // Operations.
  const unmarked = byKind.get("session_unmarked");
  const overload = byKind.get("teacher_overload");
  const noTeacher = byKind.get("class_without_teacher");
  const load = new Map<string, number>();
  for (const s of sessionStore.all()) {
    if (s.state !== "scheduled" || !cls.some((c) => c.id === s.classId)) continue;
    const t0 = Date.parse(s.at);
    const teacher = teacherOfSession(s);
    if (unmarked && t0 + unmarked.params.hours * 3_600_000 <= now && !isMarked(s.id))
      out.push({
        rule: unmarked,
        key: s.id,
        subject: { type: "session", id: s.id, label: `${s.title} · ${className(s.classId)}` },
        evidence: `Started ${formatCenterDateTime(s.at)}; attendance not taken`,
        teacherIds: teacher ? [teacher] : [],
      });
    if (teacher && t0 > now && t0 <= now + 7 * 86_400_000)
      load.set(teacher, (load.get(teacher) ?? 0) + 1);
  }
  if (overload)
    for (const [t, n] of load)
      if (n > overload.params.sessionsPerWeek)
        out.push({
          rule: overload,
          key: t,
          subject: { type: "teacher", id: t, label: teacherName(t) ?? "Teacher" },
          evidence: `${n} sessions in the next 7 days (more than ${overload.params.sessionsPerWeek})`,
          teacherIds: [],
        });
  if (noTeacher)
    for (const c of cls)
      if (!classTeachers[c.id])
        out.push({
          rule: noTeacher,
          key: c.id,
          subject: { type: "class", id: c.id, label: c.name },
          evidence: "No class teacher assigned",
          teacherIds: [],
        });

  return out;
}

// ── Decide + Act ─────────────────────────────────────────────────────────────────────────────
function notify(recipient: string, n: EngineNotification) {
  const list = inbox.get(recipient) ?? [];
  list.unshift(n);
  inbox.set(recipient, list.slice(0, CAP));
}

export function runEngine(orgId: string, now = Date.now()): JobStatus {
  const t0 = performance.now();
  const log = logFor(orgId);
  const found = detect(orgId, now);
  let fresh = 0;
  let skipped = 0;
  const at = new Date(now).toISOString();
  for (const d of found) {
    const k = `${d.rule.id}|${d.key}`;
    const last = log.lastFired.get(k);
    if (last !== undefined && now - last < d.rule.cooldownMin * 60_000) {
      skipped++;
      continue;
    }
    log.lastFired.set(k, now);
    fresh++;
    const ev: EngineEvent = {
      id: `EV-${++seq}`,
      ruleId: d.rule.id,
      ruleName: d.rule.name,
      kind: d.rule.kind,
      priority: d.rule.priority,
      at,
      subject: d.subject,
      evidence: d.evidence,
    };
    log.events.unshift(ev);
    const act = (action: ActionLogEntry["action"], target: string) =>
      log.actions.unshift({
        id: `AC-${++seq}`,
        eventId: ev.id,
        ruleName: d.rule.name,
        action,
        target,
        at,
      });
    const text = `${d.rule.name}: ${d.subject.label} — ${d.evidence}`;
    for (const a of d.rule.actions) {
      if (a === "log_only") act(a, "log");
      if (a === "support_queue" && QUEUE_KINDS.includes(d.rule.kind))
        act(a, "Learners needing support");
      if (a === "notify_teacher")
        for (const t of d.teacherIds) {
          notify(`teacher:${t}`, {
            id: `NT-${++seq}`,
            eventId: ev.id,
            priority: d.rule.priority,
            text,
            at,
            read: false,
          });
          act(a, teacherName(t) ?? "teacher");
        }
      if (a === "notify_staff") {
        notify(`staff:${orgId}`, {
          id: `NT-${++seq}`,
          eventId: ev.id,
          priority: d.rule.priority,
          text,
          at,
          read: false,
        });
        act(a, "center staff");
      }
    }
  }
  log.events = log.events.slice(0, CAP);
  log.actions = log.actions.slice(0, CAP);
  log.job = {
    runs: log.job.runs + 1,
    lastRunAt: at,
    lastDurationMs: Math.round(performance.now() - t0),
    lastDetected: found.length,
    lastNewEvents: fresh,
    lastSkippedCooldown: skipped,
    intervalSec: JOB_INTERVAL_SEC,
  };
  return log.job;
}

/** The "job": runs when a page asks and the last run is older than the interval. */
function ensureRecent(orgId: string): void {
  const last = logFor(orgId).job.lastRunAt;
  if (!last || Date.now() - Date.parse(last) >= JOB_INTERVAL_SEC * 1000) runEngine(orgId);
}

const staffOrg = (viewer: string) => {
  const p = personaMap[viewer];
  return p?.staff ? p.orgId : null;
};
const recipientOf = (viewer: string): { key: string; orgId: string } | null => {
  const p = personaMap[viewer];
  if (p?.staff) return { key: `staff:${p.orgId}`, orgId: p.orgId };
  if (p?.teacherId) return { key: `teacher:${p.teacherId}`, orgId: p.orgId };
  return null;
};

function validate(rule: Rule): string | null {
  const spec = RULE_PARAMS[rule.kind];
  for (const [k, v] of Object.entries(spec)) {
    const x = rule.params[k];
    if (!Number.isInteger(x) || x < v.min || x > v.max)
      return `${v.label} must be ${v.min}–${v.max}`;
  }
  if (!Number.isInteger(rule.cooldownMin) || rule.cooldownMin < 0 || rule.cooldownMin > 10080)
    return "cooldown must be 0–10080 minutes";
  if (rule.actions.length === 0) return "choose at least one action";
  if (rule.actions.includes("support_queue") && !QUEUE_KINDS.includes(rule.kind))
    return "only learner rules can use the support queue";
  return null;
}

export const mockDecisionEngine: DecisionEnginePort = {
  listRules: (viewer) =>
    withFault("engine.listRules", () => {
      const org = staffOrg(viewer);
      return latency(
        org
          ? rulesFor(org).map((r) => ({ ...r, params: { ...r.params }, actions: [...r.actions] }))
          : null,
      );
    }),

  updateRule: (viewer, ruleId, patch) =>
    withFault("engine.updateRule", () => {
      const org = staffOrg(viewer);
      if (!org) return latency<RuleUpdateResult>({ ok: false, reason: "not_staff" });
      const list = rulesFor(org);
      const i = list.findIndex((r) => r.id === ruleId);
      if (i < 0) return latency<RuleUpdateResult>({ ok: false, reason: "not_found" });
      // Access policy (narrows only): may tune rules; "actions" may be read-only.
      const verdict = decide(viewer, "engine:manage");
      if (!verdict.ok) return latency<RuleUpdateResult>({ ok: false, reason: "access_policy" });
      const sameActions = (a: readonly string[], b: readonly string[]) =>
        a.length === b.length && a.every((x) => b.includes(x));
      if (
        patch.actions &&
        verdict.readonly.includes("actions") &&
        !sameActions([...new Set(patch.actions)], list[i].actions)
      )
        return latency<RuleUpdateResult>({
          ok: false,
          reason: "access_policy",
          detail: "rule actions are read-only for you",
        });
      const next: Rule = {
        ...list[i],
        ...patch,
        params: { ...list[i].params, ...(patch.params ?? {}) },
        actions: patch.actions ? [...new Set(patch.actions)] : list[i].actions,
        // kind, category, name, description, id are fixed (no free-form rules yet)
        kind: list[i].kind,
        id: list[i].id,
      };
      const bad = validate(next);
      if (bad) return latency<RuleUpdateResult>({ ok: false, reason: "invalid", detail: bad });
      list[i] = next;
      return latency<RuleUpdateResult>({ ok: true, rule: { ...next } });
    }),

  runNow: (viewer) =>
    withFault("engine.runNow", () => {
      const org = staffOrg(viewer);
      return latency(org ? runEngine(org) : null);
    }),

  listEvents: (viewer) =>
    withFault("engine.listEvents", () => {
      const org = staffOrg(viewer);
      if (!org) return latency<EngineEvent[]>([]);
      ensureRecent(org);
      return latency(logFor(org).events.map((e) => ({ ...e })));
    }),

  listActions: (viewer) =>
    withFault("engine.listActions", () => {
      const org = staffOrg(viewer);
      if (!org) return latency<ActionLogEntry[]>([]);
      ensureRecent(org);
      return latency(logFor(org).actions.map((a) => ({ ...a })));
    }),

  getJobStatus: (viewer) =>
    withFault("engine.getJobStatus", () => {
      const org = staffOrg(viewer);
      return latency(org ? { ...logFor(org).job } : null);
    }),

  listNotifications: (viewer) =>
    withFault("engine.listNotifications", () => {
      const r = recipientOf(viewer);
      if (!r) return latency<EngineNotification[]>([]);
      ensureRecent(r.orgId);
      return latency((inbox.get(r.key) ?? []).map((n) => ({ ...n })));
    }),

  markRead: (viewer, id) =>
    withFault("engine.markRead", () => {
      const r = recipientOf(viewer);
      if (r) for (const n of inbox.get(r.key) ?? []) if (id === "all" || n.id === id) n.read = true;
      return latency(undefined);
    }),
};

registerPersistent("engine", {
  dump: () => ({ logs, inbox, seq }),
  load: (raw) => {
    const d = raw as { logs?: unknown; inbox?: unknown; seq?: number };
    refill(logs, d.logs);
    refill(inbox, d.inbox);
    seq = Number(d.seq) || 0;
  },
});
