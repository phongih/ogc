/*
 * Decision Engine on the Platform API (owner 23/11, PR B of the slice "skill profile, Current
 * Students & Decision Engine"). The rules of the demo's runner (apps/web/src/lib/adapters/
 * mockDecisionEngine.ts, owner decisions 21/11), on PostgreSQL:
 *  - Observe (read the live tables) → Detect (each enabled rule's condition) → Decide (cooldown per
 *    rule and subject) → Act: a log entry, an in-app notification to the class teacher / center
 *    staff, or the "learners needing support" list (Current Students). The engine never assigns
 *    work, changes a score or moves a lesson — people decide;
 *  - center staff (engine:manage) tune the fixed rule set (the shared DEFAULT_ENGINE_RULES):
 *    on / off, priority, cooldown, thresholds within their ranges, actions (which a policy may make
 *    read-only). No free-form rules;
 *  - it runs when a staff or teacher page asks and the last run is older than 60 s (owner 23/11:
 *    no background service), serialised per organization; "Run now" for staff.
 * Rules without data on the Platform yet detect nothing: speaking_returned (no speaking review)
 * and no_practice (no practice attempts); both are off by default.
 */
import { sql } from "kysely";
import {
  QUEUE_KINDS,
  RULE_PARAMS,
  authorize,
  seedProfile,
  skillLabel,
  supportSignals,
} from "@ogc/contracts";
import type {
  ActionLogEntry,
  EngineEvent,
  EngineNotification,
  JobStatus,
  Priority,
  Rule,
  RuleAction,
  RuleKind,
  RuleUpdate,
  RuleUpdateResult,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { overdueInvoices } from "./billing.js";
import { studioInactive } from "./classCourses.js";
import { makeupItems } from "./makeup.js";
import { absenceStreak, fmtDate, loadInputs } from "./students.js";

export const JOB_INTERVAL_SEC = 60;
const LIST_CAP = 300;
const DAY = 86_400_000;
const HOUR = 3_600_000;

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);

interface Detection {
  rule: Rule;
  key: string; // cooldown key per subject
  subject: EngineEvent["subject"];
  evidence: string;
  teacherIds: string[]; // who "notify_teacher" reaches
}

export async function loadRules(tx: TenantTx): Promise<Rule[]> {
  const rows = await tx.selectFrom("engine_rule").selectAll().execute();
  return rows
    .map((r) => ({
      id: r.id,
      kind: r.kind as RuleKind,
      category: r.category as Rule["category"],
      name: r.name,
      description: r.description,
      enabled: r.enabled,
      priority: r.priority as Priority,
      cooldownMin: r.cooldown_min,
      params: r.params as Record<string, number>,
      actions: r.actions as RuleAction[],
    }))
    .sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
}

// ── Observe + Detect ───────────────────────────────────────────────────────────────────────
async function detect(tx: TenantTx, orgId: string, now: number, rules: Rule[]) {
  const byKind = new Map(rules.filter((r) => r.enabled).map((r) => [r.kind, r]));
  const out: Detection[] = [];
  const x = await loadInputs(tx, orgId);
  const l = x.ledger;
  const classes = [...l.classes.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));

  // Learners (own classes): learning signals + absences, under the engine's rules.
  const low = byKind.get("skill_low");
  const drop = byKind.get("skill_drop");
  const absent = byKind.get("absence_streak");
  const learners = new Map<string, string[]>();
  for (const [id] of classes)
    for (const key of l.roster) {
      const [c, learnerId] = key.split("|");
      if (c === id) learners.set(learnerId, [...(learners.get(learnerId) ?? []), c]);
    }
  for (const [learnerId, own] of learners) {
    const teachers = [
      ...new Set(own.map((c) => l.classes.get(c)!.teacherId).filter((t): t is string => !!t)),
    ];
    const subject = {
      type: "learner" as const,
      id: learnerId,
      label: `${l.learners.get(learnerId)?.name ?? "Learner"} · ${l.classes.get(own[0])!.name}`,
    };
    const placement = x.placements.get(learnerId);
    if (placement && (low || drop))
      for (const s of supportSignals(seedProfile(placement), x.evidence.get(learnerId) ?? [], 0, {
        low: low ? low.params.threshold : null,
        drop: drop ? drop.params.drop : null,
      })) {
        const skill = s.skill ? skillLabel(s.skill) : "";
        if (s.kind === "low_skill" && low)
          out.push({
            rule: low,
            key: `${learnerId}|${s.skill}`,
            subject,
            evidence: `${skill} is ${s.level}, below ${s.threshold} (${s.source === "placement" ? "placement test only" : "from class-course quizzes"})`,
            teacherIds: teachers,
          });
        if (s.kind === "skill_drop" && drop)
          out.push({
            rule: drop,
            key: `${learnerId}|${s.skill}`,
            subject,
            evidence: `${skill} dropped ${Math.abs(s.delta ?? 0)} to ${s.level} after the latest class-course quiz`,
            teacherIds: teachers,
          });
      }
    if (absent) {
      const streak = absenceStreak(l, learnerId, own);
      if (streak >= absent.params.sessions)
        out.push({
          rule: absent,
          key: `${learnerId}|`,
          subject,
          evidence: `Absent from the last ${streak} marked sessions`,
          teacherIds: teachers,
        });
    }
  }

  // Make-ups.
  const due = byKind.get("makeup_due_soon");
  const over = byKind.get("makeup_overdue");
  const again = byKind.get("makeup_missed_again");
  for (const i of makeupItems(l, now)) {
    if (i.status === "done") continue;
    const subject = {
      type: "makeup" as const,
      id: i.id,
      label: `${i.learnerName} · ${i.unitTitle}`,
    };
    const t = l.classes.get(i.classId)?.teacherId;
    const teachers = t ? [t] : [];
    const left = Math.ceil((Date.parse(i.dueAt) - now) / DAY);
    if (over && i.overdue)
      out.push({
        rule: over,
        key: i.id,
        subject,
        evidence: `Not made up; deadline ${fmtDate(i.dueAt)} has passed`,
        teacherIds: teachers,
      });
    else if (due && left <= due.params.days)
      out.push({
        rule: due,
        key: i.id,
        subject,
        evidence: `Not made up; ${left} day${left === 1 ? "" : "s"} left (due ${fmtDate(i.dueAt)})`,
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
  const marked = new Set([...l.marks.keys()].map((k) => k.split("|")[0]));
  const load = new Map<string, number>();
  for (const s of l.sessions.values()) {
    if (s.state !== "scheduled") continue;
    const t0 = s.at.getTime();
    const teacher = s.substituteId ?? s.heldBy ?? l.classes.get(s.classId)?.teacherId ?? null;
    if (unmarked && t0 + unmarked.params.hours * HOUR <= now && !marked.has(s.id))
      out.push({
        rule: unmarked,
        key: s.id,
        subject: {
          type: "session",
          id: s.id,
          label: `${s.title} · ${l.classes.get(s.classId)?.name ?? "a class"}`,
        },
        evidence: `Started ${fmtDateTime(s.at)}; attendance not taken`,
        teacherIds: teacher ? [teacher] : [],
      });
    if (teacher && t0 > now && t0 <= now + 7 * DAY) load.set(teacher, (load.get(teacher) ?? 0) + 1);
  }
  if (overload)
    for (const [t, n] of load)
      if (n > overload.params.sessionsPerWeek)
        out.push({
          rule: overload,
          key: t,
          subject: { type: "teacher", id: t, label: l.teachers.get(t) ?? "Teacher" },
          evidence: `${n} sessions in the next 7 days (more than ${overload.params.sessionsPerWeek})`,
          teacherIds: [],
        });
  const noTeacher = byKind.get("class_without_teacher");
  if (noTeacher)
    for (const [id, c] of classes)
      if (!c.teacherId)
        out.push({
          rule: noTeacher,
          key: id,
          subject: { type: "class", id, label: c.name },
          evidence: "No class teacher assigned",
          teacherIds: [],
        });
  const overdue = byKind.get("invoice_overdue");
  if (overdue)
    for (const inv of await overdueInvoices(tx, overdue.params.days, now))
      out.push({
        rule: overdue,
        key: inv.id,
        subject: { type: "invoice", id: inv.id, label: `${inv.no} · ${inv.learnerName}` },
        evidence: `${inv.daysOverdue} days overdue (due ${inv.dueDate}); balance ${inv.balanceVnd.toLocaleString("vi-VN")} ₫ at ${inv.centerName}`,
        teacherIds: [],
      });
  const studio = byKind.get("studio_inactive");
  if (studio)
    for (const s of await studioInactive(tx, studio.params.days, now))
      out.push({
        rule: studio,
        key: `${s.classId}|${s.learnerId}`,
        subject: { type: "learner", id: s.learnerId, label: s.name },
        evidence: `No class course activity since ${fmtDateTime(new Date(s.since))} in "${s.course}" (${s.className})`,
        teacherIds: s.teacherId ? [s.teacherId] : [],
      });
  return { found: out, teachers: l.teachers };
}

// ── Decide + Act ───────────────────────────────────────────────────────────────────────────
async function jobOf(tx: TenantTx) {
  return tx.selectFrom("engine_job").selectAll().executeTakeFirst();
}
function jobView(j: Awaited<ReturnType<typeof jobOf>>): JobStatus {
  return {
    runs: j?.runs ?? 0,
    lastRunAt: j?.last_run_at ? j.last_run_at.toISOString() : null,
    lastDurationMs: j?.last_duration_ms ?? null,
    lastDetected: j?.last_detected ?? 0,
    lastNewEvents: j?.last_new_events ?? 0,
    lastSkippedCooldown: j?.last_skipped ?? 0,
    intervalSec: JOB_INTERVAL_SEC,
  };
}

/** One run for the caller's organization (the caller holds the engine lock). */
export async function runEngine(tx: TenantTx, orgId: string, now: number): Promise<JobStatus> {
  const t0 = Date.now();
  const rules = await loadRules(tx);
  const { found, teachers } = await detect(tx, orgId, now, rules);
  const fired = new Map(
    (await tx.selectFrom("engine_fired").selectAll().execute()).map((f) => [
      `${f.rule_id}|${f.key}`,
      f.at.getTime(),
    ]),
  );
  const job = await jobOf(tx);
  let seq = Number(job?.seq ?? 0);
  let fresh = 0;
  let skipped = 0;
  const at = new Date(now);
  for (const d of found) {
    const k = `${d.rule.id}|${d.key}`;
    const last = fired.get(k);
    if (last !== undefined && now - last < d.rule.cooldownMin * 60_000) {
      skipped++;
      continue;
    }
    await sql`insert into engine_fired (org_id, rule_id, key, at) values (ogc_current_org(), ${d.rule.id}, ${d.key}, ${at})
              on conflict (org_id, rule_id, key) do update set at = excluded.at`.execute(tx);
    fired.set(k, now);
    fresh++;
    const eventId = `EV-${++seq}`;
    await tx
      .insertInto("engine_event")
      .values({
        org_id: sql`ogc_current_org()`,
        id: eventId,
        rule_id: d.rule.id,
        rule_name: d.rule.name,
        kind: d.rule.kind,
        priority: d.rule.priority,
        at,
        subject: JSON.stringify(d.subject),
        evidence: d.evidence,
      } as never)
      .execute();
    const act = (action: RuleAction, target: string) =>
      tx
        .insertInto("engine_action")
        .values({
          org_id: sql`ogc_current_org()`,
          id: `AC-${++seq}`,
          event_id: eventId,
          rule_name: d.rule.name,
          action,
          target,
          at,
        } as never)
        .execute();
    const notify = (recipient: string) =>
      tx
        .insertInto("engine_notification")
        .values({
          org_id: sql`ogc_current_org()`,
          id: `NT-${++seq}`,
          recipient,
          event_id: eventId,
          priority: d.rule.priority,
          text: `${d.rule.name}: ${d.subject.label} — ${d.evidence}`,
          at,
          read: false,
        } as never)
        .execute();
    for (const a of d.rule.actions) {
      if (a === "log_only") await act(a, "log");
      if (a === "support_queue" && QUEUE_KINDS.includes(d.rule.kind))
        await act(a, "Learners needing support");
      if (a === "notify_teacher")
        for (const t of d.teacherIds) {
          await notify(`teacher:${t}`);
          await act(a, teachers.get(t) ?? "teacher");
        }
      if (a === "notify_staff") {
        await notify("staff");
        await act(a, "center staff");
      }
    }
  }
  const values = {
    runs: (job?.runs ?? 0) + 1,
    last_run_at: at,
    last_duration_ms: Date.now() - t0,
    last_detected: found.length,
    last_new_events: fresh,
    last_skipped: skipped,
    seq,
  };
  if (job) await tx.updateTable("engine_job").set(values).execute();
  else
    await tx
      .insertInto("engine_job")
      .values({ org_id: sql`ogc_current_org()`, ...values } as never)
      .execute();
  return jobView(await jobOf(tx));
}

const lock = (tx: TenantTx, orgId: string) =>
  sql`select pg_advisory_xact_lock(hashtext('engine:' || ${orgId}))`.execute(tx);

/** The "job": run when a page asks and the last run is older than the interval. */
async function ensureRecent(tx: TenantTx, orgId: string, now: number): Promise<void> {
  const last = (await jobOf(tx))?.last_run_at;
  if (last && now - last.getTime() < JOB_INTERVAL_SEC * 1000) return;
  await lock(tx, orgId);
  const again = (await jobOf(tx))?.last_run_at; // someone else may have run it meanwhile
  if (again && now - again.getTime() < JOB_INTERVAL_SEC * 1000) return;
  await runEngine(tx, orgId, now);
}

export function validateRule(rule: Rule): string | null {
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

// ── routes ──────────────────────────────────────────────────────────────────────────────────
export function registerEngine(app: Api): void {
  const isStaff = (c: Caller) => c.ctx.role === "staff";
  /** Who a notification is for: center staff, or a teacher by their OGC record. */
  const recipientOf = async (tx: TenantTx, c: Caller): Promise<string | null> => {
    if (isStaff(c)) return "staff";
    if (c.ctx.role !== "teacher") return null;
    const t = await tx
      .selectFrom("teacher")
      .select("id")
      .where("principal_id", "=", c.ctx.principalId)
      .executeTakeFirst();
    return t ? `teacher:${t.id}` : null;
  };
  const staffRead = <T>(url: string, run: (tx: TenantTx, c: Caller) => Promise<T>) =>
    app.secured("GET", url, async (caller, _req, reply) => {
      if (!isStaff(caller)) return reply.code(403).send({ error: "not_staff" });
      return caller.tenant((tx) => run(tx, caller));
    });

  staffRead("/v1/engine/rules", (tx) => loadRules(tx));

  staffRead("/v1/engine/events", async (tx, c): Promise<EngineEvent[]> => {
    await ensureRecent(tx, c.ctx.orgId, c.now());
    const rows = await tx
      .selectFrom("engine_event")
      .selectAll()
      .orderBy("at", "desc")
      .orderBy(sql`(substring(id from 4))::bigint`, "desc")
      .limit(LIST_CAP)
      .execute();
    return rows.map((e) => ({
      id: e.id,
      ruleId: e.rule_id,
      ruleName: e.rule_name,
      kind: e.kind as RuleKind,
      priority: e.priority as Priority,
      at: e.at.toISOString(),
      subject: e.subject as EngineEvent["subject"],
      evidence: e.evidence,
    }));
  });

  staffRead("/v1/engine/actions", async (tx, c): Promise<ActionLogEntry[]> => {
    await ensureRecent(tx, c.ctx.orgId, c.now());
    const rows = await tx
      .selectFrom("engine_action")
      .selectAll()
      .orderBy("at", "desc")
      .orderBy(sql`(substring(id from 4))::bigint`, "desc")
      .limit(LIST_CAP)
      .execute();
    return rows.map((a) => ({
      id: a.id,
      eventId: a.event_id,
      ruleName: a.rule_name,
      action: a.action as RuleAction,
      target: a.target,
      at: a.at.toISOString(),
    }));
  });

  staffRead("/v1/engine/job", async (tx) => jobView(await jobOf(tx)));

  app.secured("GET", "/v1/me/notifications", async (caller, _req, reply) =>
    caller.tenant(async (tx) => {
      const r = await recipientOf(tx, caller);
      if (!r) return reply.code(403).send({ error: "not_allowed" });
      await ensureRecent(tx, caller.ctx.orgId, caller.now());
      const rows = await tx
        .selectFrom("engine_notification")
        .selectAll()
        .where("recipient", "=", r)
        .orderBy("at", "desc")
        .orderBy(sql`(substring(id from 4))::bigint`, "desc")
        .limit(LIST_CAP)
        .execute();
      return rows.map((n): EngineNotification => ({
        id: n.id,
        eventId: n.event_id,
        priority: n.priority as Priority,
        text: n.text,
        at: n.at.toISOString(),
        read: n.read,
      }));
    }),
  );

  app.secured("POST", "/v1/me/notifications/:id/read", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    await caller.write<{ ok: boolean; reason?: string }>(
      "POST /v1/me/notifications/:id/read",
      { id },
      async (tx) => {
        const r = await recipientOf(tx, caller);
        let marked = 0;
        if (r) {
          let q = tx
            .updateTable("engine_notification")
            .set({ read: true })
            .where("recipient", "=", r)
            .where("read", "=", false);
          if (id !== "all") q = q.where("id", "=", id);
          marked = Number((await q.executeTakeFirst()).numUpdatedRows);
        }
        return {
          status: r ? 200 : 403,
          body: r ? { ok: true } : { ok: false, reason: "not_allowed" },
          audit: {
            action: "engine:notification.read",
            resource: { id },
            outcome: r ? ("allowed" as const) : ("denied" as const),
            ...(r ? { after: { marked } } : { reason: "not_allowed" }),
          },
        };
      },
    );
  });

  app.secured("POST", "/v1/engine/run", async (caller) => {
    await caller.write<JobStatus | { ok: false; reason: string }>(
      "POST /v1/engine/run",
      {},
      async (tx) => {
        if (!isStaff(caller))
          return {
            status: 403,
            body: { ok: false, reason: "not_staff" },
            audit: { action: "engine:run", resource: {}, outcome: "denied", reason: "not_staff" },
          };
        await lock(tx, caller.ctx.orgId);
        const job = await runEngine(tx, caller.ctx.orgId, caller.now());
        return {
          status: 200,
          body: job,
          audit: { action: "engine:run", resource: {}, outcome: "allowed", after: job },
        };
      },
    );
  });

  app.secured("POST", "/v1/engine/rules/:id", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const patch = (req.body ?? {}) as RuleUpdate;
    await caller.write<RuleUpdateResult>("POST /v1/engine/rules/:id", { id, patch }, async (tx) => {
      const r = await updateRule(tx, caller, id, patch);
      return {
        status: r.ok ? 200 : r.reason === "not_found" ? 404 : r.reason === "invalid" ? 422 : 403,
        body: r,
        audit: {
          action: "engine:manage",
          resource: { ruleId: id },
          outcome: r.ok ? ("allowed" as const) : ("denied" as const),
          ...(r.ok ? { after: r.rule } : { reason: r.reason }),
        },
      };
    });
  });

  async function updateRule(
    tx: TenantTx,
    caller: Caller,
    id: string,
    patch: RuleUpdate,
  ): Promise<RuleUpdateResult> {
    if (!isStaff(caller)) return { ok: false, reason: "not_staff" };
    const rules = await loadRules(tx);
    const cur = rules.find((r) => r.id === id);
    if (!cur) return { ok: false, reason: "not_found" };
    const verdict = authorize(caller.ctx, "engine:manage", { orgId: caller.ctx.orgId });
    if (!verdict.allow) return { ok: false, reason: "access_policy" };
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      return { ok: false, reason: "invalid", detail: "a rule change is required" };
    const known = ["enabled", "priority", "cooldownMin", "params", "actions"];
    if (Object.keys(patch).some((k) => !known.includes(k)))
      return {
        ok: false,
        reason: "invalid",
        detail: "only enabled, priority, cooldown, thresholds and actions can change",
      };
    if (patch.enabled !== undefined && typeof patch.enabled !== "boolean")
      return { ok: false, reason: "invalid", detail: "enabled must be true or false" };
    if (patch.priority !== undefined && !["P1", "P2", "P3"].includes(patch.priority))
      return { ok: false, reason: "invalid", detail: "priority must be P1, P2 or P3" };
    if (
      patch.params !== undefined &&
      (!patch.params ||
        typeof patch.params !== "object" ||
        Object.keys(patch.params).some((k) => !(k in RULE_PARAMS[cur.kind])))
    )
      return { ok: false, reason: "invalid", detail: "unknown threshold for this rule" };
    const actions = patch.actions !== undefined ? [...new Set(patch.actions)] : cur.actions;
    if (
      patch.actions !== undefined &&
      (!Array.isArray(patch.actions) ||
        actions.some(
          (a) => !["log_only", "notify_teacher", "notify_staff", "support_queue"].includes(a),
        ))
    )
      return { ok: false, reason: "invalid", detail: "unknown action" };
    const same =
      actions.length === cur.actions.length && actions.every((a) => cur.actions.includes(a));
    if (patch.actions !== undefined && verdict.readonly.includes("actions") && !same)
      return { ok: false, reason: "access_policy", detail: "rule actions are read-only for you" };
    const next: Rule = {
      ...cur,
      enabled: patch.enabled ?? cur.enabled,
      priority: patch.priority ?? cur.priority,
      cooldownMin: patch.cooldownMin ?? cur.cooldownMin,
      params: { ...cur.params, ...(patch.params ?? {}) },
      actions,
    };
    const bad = validateRule(next);
    if (bad) return { ok: false, reason: "invalid", detail: bad };
    const by =
      (
        await tx
          .selectFrom("staff_member")
          .select("display_name")
          .where("principal_id", "=", caller.ctx.principalId)
          .executeTakeFirst()
      )?.display_name ?? caller.ctx.principalId;
    await sql`update engine_rule set enabled = ${next.enabled}, priority = ${next.priority},
                cooldown_min = ${next.cooldownMin}, params = ${JSON.stringify(next.params)}::jsonb,
                actions = ${next.actions}::text[], updated_by = ${by}, updated_at = ${new Date(caller.now())}
              where id = ${id}`.execute(tx);
    return { ok: true, rule: next };
  }
}
