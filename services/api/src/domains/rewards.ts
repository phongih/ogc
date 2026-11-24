/*
 * Gamification on the Platform API (owner 24/11; the demo's rules, owner 22/11 — shared in
 * @ogc/contracts). Rewards are DERIVED from learning evidence on every read, never stored and never
 * awarded by hand, never for logging in:
 *  - a completed class-course lesson (activity) and its quiz score (scored practice);
 *  - a speaking rehearsal the class teacher approved;
 *  - a make-up done (attended, or self-study confirmed by the class teacher).
 * XP + levels, a streak of learning days (center time), badges, a weekly class leaderboard.
 * A learner sees their own; a guardian their linked child's (rank only, no classmates' names);
 * teachers and staff see no XP. Staff with rewards:manage tune the closed catalog.
 */
import {
  applyGamificationUpdate,
  authorize,
  DEFAULT_GAMIFICATION,
  deriveRewards,
  gamificationView,
  weeklyXpOf,
} from "@ogc/contracts";
import type {
  BadgeKind,
  GamificationSettings,
  GamificationUpdate,
  GamificationUpdateResult,
  LearnerGamification,
  RewardEvidence,
  RewardKind,
} from "@ogc/contracts";
import { sql } from "kysely";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { loadLedger, makeupItems } from "./makeup.js";

const iso = (d: Date) => new Date(d).toISOString();

export async function settingsOf(tx: TenantTx): Promise<GamificationSettings> {
  const [base, rules, badges] = await Promise.all([
    tx.selectFrom("reward_settings").selectAll().executeTakeFirst(),
    tx.selectFrom("reward_rule").selectAll().execute(),
    tx.selectFrom("badge_rule").selectAll().execute(),
  ]);
  const s: GamificationSettings = JSON.parse(JSON.stringify(DEFAULT_GAMIFICATION));
  if (base) {
    s.levelSize = base.level_size;
    s.leaderboardEnabled = base.leaderboard_enabled;
  }
  for (const r of rules) {
    const x = s.rules.find((y) => y.kind === r.kind);
    if (x) Object.assign(x, { enabled: r.enabled, xp: r.xp });
  }
  for (const b of badges) {
    const x = s.badges.find((y) => y.kind === b.kind);
    if (x)
      Object.assign(x, {
        enabled: b.enabled,
        threshold: x.threshold === null ? null : b.threshold,
      });
  }
  return s;
}

/** Every learner's reward evidence in the organization in scope. */
export async function evidenceByLearner(
  tx: TenantTx,
  now: number,
): Promise<Map<string, RewardEvidence[]>> {
  const [lessons, speaking, ledger] = await Promise.all([
    sql<{ learner_id: string; at: Date; score: number | null; title: string | null }>`
      select d.learner_id, d.at, d.score,
             (select l->>'title' from jsonb_array_elements(v.content->'lessons') l
               where l->>'id' = d.lesson_id limit 1) as title
        from course_lesson_done d
        join course_progress p on p.org_id = d.org_id and p.learner_id = d.learner_id
                              and p.course_ref = d.course_ref
        join course_version v on v.org_id = p.org_id and v.course_ref = p.course_ref
                             and v.version = p.version`.execute(tx),
    sql<{ learner_id: string; at: Date; title: string | null }>`
      select a.learner_id, a.reviewed_at as at,
             (select l->>'title' from jsonb_array_elements(v.content->'lessons') l
               where l->>'id' = a.lesson_id limit 1) as title
        from course_speaking_attempt a
        join course_progress p on p.org_id = a.org_id and p.learner_id = a.learner_id
                              and p.course_ref = a.course_ref
        join course_version v on v.org_id = p.org_id and v.course_ref = p.course_ref
                             and v.version = p.version
       where a.status = 'approved'`.execute(tx),
    loadLedger(tx),
  ]);
  const out = new Map<string, RewardEvidence[]>();
  const add = (id: string, e: RewardEvidence) => out.set(id, [...(out.get(id) ?? []), e]);
  for (const r of lessons.rows)
    add(r.learner_id, {
      kind: "activity",
      at: iso(r.at),
      title: r.title ?? "Lesson",
      score: r.score,
    });
  for (const r of speaking.rows)
    add(r.learner_id, {
      kind: "speaking",
      at: iso(r.at),
      title: `Speaking · ${r.title ?? "lesson"}`,
    });
  for (const m of makeupItems(ledger, now)) {
    if (m.status !== "done") continue;
    add(m.learnerId, {
      kind: "makeup",
      at: m.booking?.selfStudy?.confirmedAt ?? m.booking?.at ?? m.dueAt,
      dueAt: m.dueAt,
      unitTitle: m.unitTitle,
      className: m.className,
    });
  }
  return out;
}

async function viewsFor(
  tx: TenantTx,
  learnerIds: string[],
  forGuardian: boolean,
  now: number,
): Promise<LearnerGamification[]> {
  if (!learnerIds.length) return [];
  const [settings, evidence, learners, roster] = await Promise.all([
    settingsOf(tx),
    evidenceByLearner(tx, now),
    tx.selectFrom("learner").select(["id", "display_name"]).execute(),
    sql<{ class_id: string; class_name: string; learner_id: string }>`
      select r.class_id, k.name as class_name, r.learner_id
        from roster r join class k on k.id = r.class_id and k.org_id = r.org_id
       order by k.name, r.learner_id`.execute(tx),
  ]);
  const name = new Map(learners.map((l) => [l.id, l.display_name]));
  const weekly = (id: string) =>
    weeklyXpOf(deriveRewards(evidence.get(id) ?? [], settings).events, now);
  return learnerIds.map((id) => {
    // The learner's class for the leaderboard: the first by name (a learner usually has one).
    const mine = roster.rows.find((r) => r.learner_id === id);
    return gamificationView({
      learnerId: id,
      displayName: name.get(id) ?? "Learner",
      evidence: evidence.get(id) ?? [],
      settings,
      now,
      forGuardian,
      klass: mine
        ? {
            name: mine.class_name,
            members: roster.rows
              .filter((r) => r.class_id === mine.class_id)
              .map((r) => ({
                learnerId: r.learner_id,
                name: name.get(r.learner_id) ?? "Learner",
                weeklyXp: weekly(r.learner_id),
              })),
          }
        : null,
    });
  });
}

const STATUS: Record<string, number> = { not_staff: 403, access_policy: 403, invalid: 422 };
const RULE_KINDS = new Set<string>(DEFAULT_GAMIFICATION.rules.map((r) => r.kind));
const BADGE_KINDS = new Set<string>(DEFAULT_GAMIFICATION.badges.map((b) => b.kind));

/** Only the closed shape: unknown fields refused before the catalog check. */
function shapeIssue(d: Record<string, unknown>): string | null {
  const top = new Set(["rules", "badges", "levelSize", "leaderboardEnabled"]);
  if (Object.keys(d).some((k) => !top.has(k))) return "unknown field";
  const list = (x: unknown, keys: string[], kinds: Set<string>, what: string) => {
    if (x === undefined) return null;
    if (!Array.isArray(x)) return `${what}: a list`;
    for (const p of x) {
      if (!p || typeof p !== "object") return `${what}: a list of changes`;
      if (Object.keys(p).some((k) => !keys.includes(k))) return `${what}: unknown field`;
      if (!kinds.has((p as { kind: unknown }).kind as string))
        return `unknown ${what === "rules" ? "reward" : "badge"} ${String((p as { kind: unknown }).kind)}`;
    }
    return null;
  };
  return (
    list(d.rules, ["kind", "enabled", "xp"], RULE_KINDS, "rules") ??
    list(d.badges, ["kind", "enabled", "threshold"], BADGE_KINDS, "badges")
  );
}

export function registerRewards(app: Api): void {
  const mayManage = (c: Caller) =>
    c.ctx.role === "staff" && authorize(c.ctx, "rewards:manage", { orgId: c.ctx.orgId }).allow;

  // Learner: their own. Guardian: each linked learner (seed links only). No one else sees XP.
  app.secured("GET", "/v1/me/rewards", async (caller, _req, reply) => {
    const role = caller.ctx.role;
    if (role !== "learner" && role !== "guardian")
      return reply.code(403).send({ error: "not_learner" });
    return caller.tenant(async (tx) => {
      const ids =
        role === "learner"
          ? (
              await tx
                .selectFrom("learner")
                .select("id")
                .where("principal_id", "=", caller.ctx.principalId)
                .execute()
            ).map((r) => r.id)
          : (
              await tx
                .selectFrom("guardian_link")
                .select("learner_id")
                .where("guardian_principal_id", "=", caller.ctx.principalId)
                .orderBy("learner_id")
                .execute()
            ).map((r) => r.learner_id);
      return viewsFor(tx, ids, role === "guardian", caller.now());
    });
  });

  app.secured("GET", "/v1/rewards/settings", async (caller, _req, reply) => {
    if (caller.ctx.role !== "staff") return reply.code(403).send({ error: "not_staff" });
    return caller.tenant((tx) => settingsOf(tx));
  });

  app.secured("POST", "/v1/rewards/settings", async (caller, req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    await caller.write<GamificationUpdateResult>("POST /v1/rewards/settings", body, async (tx) => {
      let r: GamificationUpdateResult;
      if (caller.ctx.role !== "staff") r = { ok: false, reason: "not_staff" };
      else if (!mayManage(caller)) r = { ok: false, reason: "access_policy" };
      else {
        await sql`select pg_advisory_xact_lock(hashtext('rewards:' || ${caller.ctx.orgId}))`.execute(
          tx,
        );
        const bad = typeof body === "object" && !Array.isArray(body) ? shapeIssue(body) : "invalid";
        const next = bad
          ? null
          : applyGamificationUpdate(await settingsOf(tx), body as GamificationUpdate);
        if (bad) r = { ok: false, reason: "invalid", detail: bad };
        else if (!next!.ok) r = { ok: false, reason: "invalid", detail: next!.detail };
        else {
          await save(tx, caller, next!.settings);
          r = { ok: true, settings: next!.settings };
        }
      }
      return {
        status: r.ok ? 200 : STATUS[r.reason]!,
        body: r,
        audit: {
          action: "rewards:manage",
          resource: { step: "settings" },
          outcome: r.ok ? ("allowed" as const) : ("denied" as const),
          ...(r.ok ? { after: body } : { reason: r.reason }),
        },
      };
    });
  });

  async function save(tx: TenantTx, caller: Caller, s: GamificationSettings) {
    const org = caller.ctx.orgId;
    const by =
      (
        await tx
          .selectFrom("staff_member")
          .select("display_name")
          .where("principal_id", "=", caller.ctx.principalId)
          .executeTakeFirst()
      )?.display_name ?? caller.ctx.principalId;
    const base = {
      level_size: s.levelSize,
      leaderboard_enabled: s.leaderboardEnabled,
      updated_by: by,
      updated_at: new Date(caller.now()),
    };
    await tx
      .insertInto("reward_settings")
      .values({ org_id: org, ...base })
      .onConflict((oc) => oc.column("org_id").doUpdateSet(base))
      .execute();
    for (const r of s.rules)
      await tx
        .insertInto("reward_rule")
        .values({ org_id: org, kind: r.kind as RewardKind, enabled: r.enabled, xp: r.xp })
        .onConflict((oc) =>
          oc.columns(["org_id", "kind"]).doUpdateSet({ enabled: r.enabled, xp: r.xp }),
        )
        .execute();
    for (const b of s.badges)
      await tx
        .insertInto("badge_rule")
        .values({
          org_id: org,
          kind: b.kind as BadgeKind,
          enabled: b.enabled,
          threshold: b.threshold,
        })
        .onConflict((oc) =>
          oc
            .columns(["org_id", "kind"])
            .doUpdateSet({ enabled: b.enabled, threshold: b.threshold }),
        )
        .execute();
  }
}
