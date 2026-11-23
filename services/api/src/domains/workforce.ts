/*
 * Workforce · teacher load on the Platform API — the rules of the demo's mock adapter
 * (apps/web/src/lib/adapters/mockWorkforce.ts, owner decisions 22/11), on PostgreSQL:
 *  - load = TEACHING HOURS in the next 7 days from the schedule: each session's real length; a
 *    substitute's session counts for the substitute; make-up sessions count;
 *  - each teacher has their own target hours / week (full- or part-time) set by center staff;
 *    bands are % of target with thresholds staff tune (workforce:manage);
 *  - SUGGEST ONLY: candidates for a class teacher or a substitute are ranked with load before →
 *    after and any clash; nothing is assigned, going over the target only warns.
 * Not on the Platform yet: course-prep hours (Course Studio) and the new-center wizard's hint.
 */
import { authorize } from "@ogc/contracts";
import type {
  Employment,
  LoadBand,
  LoadCandidate,
  LoadPoint,
  TeacherLoad,
  WorkforceOverview,
  WorkforceRefusal,
  WorkforceResult,
  WorkforceSettings,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { clashes, slotOf, snapshot, teacherOf, type Sess, type Snapshot } from "./schedule.js";

const DAY = 86_400_000;
export const DEFAULT_SETTINGS: WorkforceSettings = { underPct: 60, overPct: 100 };
const round = (x: number) => Math.round(x * 10) / 10;

interface Plan {
  snap: Snapshot;
  targets: Map<string, { employment: Employment; targetHours: number }>;
  settings: WorkforceSettings;
}

async function plan(tx: TenantTx): Promise<Plan> {
  const [snap, targets, settings] = await Promise.all([
    snapshot(tx),
    tx.selectFrom("teacher_target").select(["teacher_id", "employment", "target_hours"]).execute(),
    tx.selectFrom("workforce_settings").select(["under_pct", "over_pct"]).executeTakeFirst(),
  ]);
  return {
    snap,
    targets: new Map(
      targets.map((t) => [
        t.teacher_id,
        { employment: t.employment, targetHours: Number(t.target_hours) },
      ]),
    ),
    settings: settings
      ? { underPct: settings.under_pct, overPct: settings.over_pct }
      : { ...DEFAULT_SETTINGS },
  };
}

const hoursOf = (p: Plan, s: Pick<Sess, "classId">) =>
  (p.snap.classes.get(s.classId)?.durationMin ?? 90) / 60;
const targetOf = (p: Plan, t: string) =>
  p.targets.get(t) ?? { employment: "part_time" as Employment, targetHours: 0 };
const windowSessions = (p: Plan, now: number) =>
  p.snap.sessions.filter(
    (s) => s.state === "scheduled" && s.at.getTime() >= now && s.at.getTime() < now + 7 * DAY,
  );

export function point(
  hours: number,
  sessions: number,
  target: number,
  s: WorkforceSettings,
): LoadPoint {
  const pct = target > 0 ? Math.round((hours / target) * 1000) / 10 : null;
  const band: LoadBand =
    pct === null
      ? hours > 0
        ? "over"
        : "under"
      : pct > s.overPct
        ? "over"
        : pct < s.underPct
          ? "under"
          : "meet";
  return { hours: round(hours), sessions, pct, band };
}

function loadOf(p: Plan, teacherId: string, now: number): TeacherLoad {
  const mine = windowSessions(p, now).filter((x) => teacherOf(p.snap, x) === teacherId);
  const groups = new Map<string, TeacherLoad["breakdown"][number]>();
  for (const x of mine) {
    const kind = x.kind === "makeup" ? "makeup" : x.substituteId ? "substitute" : "class";
    const k = `${x.classId}|${kind}`;
    const g = groups.get(k) ?? {
      label: p.snap.classes.get(x.classId)?.name ?? "a class",
      kind,
      sessions: 0,
      hours: 0,
    };
    g.sessions++;
    g.hours = round(g.hours + hoursOf(p, x));
    groups.set(k, g);
  }
  const tg = targetOf(p, teacherId);
  return {
    teacherId,
    name: p.snap.teachers.get(teacherId) ?? "Teacher",
    employment: tg.employment,
    targetHours: tg.targetHours,
    classes: [...p.snap.classes.values()].filter((c) => c.teacherId === teacherId).length,
    breakdown: [...groups.values()],
    ...point(
      mine.reduce((t, x) => t + hoursOf(p, x), 0),
      mine.length,
      tg.targetHours,
      p.settings,
    ),
  };
}

function candidates(
  p: Plan,
  now: number,
  addHours: number,
  addSessions: number,
  exclude: string | null,
  clashFor: (teacherId: string) => string[],
): LoadCandidate[] {
  const order = { meet: 0, under: 1, over: 2 } as const;
  return [...p.snap.teachers.entries()]
    .filter(([id]) => id !== exclude)
    .map(([id, name]) => {
      const L = loadOf(p, id, now);
      const before: LoadPoint = { hours: L.hours, sessions: L.sessions, pct: L.pct, band: L.band };
      const target = targetOf(p, id).targetHours;
      const after = point(
        before.hours + addHours,
        before.sessions + addSessions,
        target,
        p.settings,
      );
      const cl = clashFor(id);
      const note = cl.length
        ? "Schedule clash"
        : after.band === "over"
          ? `Would go over target (${after.pct ?? "—"}% of ${target} h)`
          : `Fits — ${after.pct ?? "—"}% of ${target} h after`;
      return { teacherId: id, name, before, after, clashes: cl, note };
    })
    .sort(
      (a, b) =>
        Number(a.clashes.length > 0) - Number(b.clashes.length > 0) ||
        order[a.after.band] - order[b.after.band] ||
        (a.after.pct ?? 999) - (b.after.pct ?? 999) ||
        a.name.localeCompare(b.name),
    );
}

function settingsIssue(s: { underPct?: unknown; overPct?: unknown }): string | null {
  if (!Number.isInteger(s.underPct) || !Number.isInteger(s.overPct))
    return "whole percentages only";
  if ((s.underPct as number) < 1 || (s.underPct as number) > 99) return "under: 1–99%";
  if ((s.overPct as number) < 100 || (s.overPct as number) > 200) return "over: 100–200%";
  return null;
}

const STATUS: Record<WorkforceRefusal, number> = {
  not_staff: 403,
  access_policy: 403,
  not_found: 404,
  invalid: 422,
};

export function registerWorkforce(app: Api): void {
  const staffOnly = (caller: Caller) => caller.ctx.role === "staff";

  app.secured("GET", "/v1/workforce", async (caller, _req, reply) => {
    if (!staffOnly(caller)) return reply.code(403).send({ error: "not_staff" });
    return caller.tenant(async (tx): Promise<WorkforceOverview> => {
      const p = await plan(tx);
      const now = caller.now();
      const list = [...p.snap.teachers.keys()]
        .map((t) => loadOf(p, t, now))
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || a.name.localeCompare(b.name));
      const totalHours = round(list.reduce((t, x) => t + x.hours, 0));
      const totalTargetHours = round(list.reduce((t, x) => t + x.targetHours, 0));
      return {
        windowFrom: new Date(now).toISOString(),
        windowTo: new Date(now + 7 * DAY).toISOString(),
        teachers: list,
        totalHours,
        totalTargetHours,
        utilizationPct:
          totalTargetHours > 0 ? Math.round((totalHours / totalTargetHours) * 1000) / 10 : null,
        bands: {
          under: list.filter((x) => x.band === "under").length,
          meet: list.filter((x) => x.band === "meet").length,
          over: list.filter((x) => x.band === "over").length,
        },
        settings: p.settings,
      };
    });
  });

  /** Staff write needing workforce:manage; idempotent, audited. */
  const manage = (
    caller: Caller,
    route: string,
    body: unknown,
    resource: Record<string, unknown>,
    run: (tx: TenantTx, p: Plan) => Promise<WorkforceResult>,
  ) =>
    caller.write<WorkforceResult>(route, body, async (tx) => {
      const refuse = (reason: WorkforceRefusal, detail?: string) => ({
        status: STATUS[reason],
        body: { ok: false as const, reason, ...(detail ? { detail } : {}) },
        audit: { action: "workforce:manage", resource, outcome: "denied" as const, reason },
      });
      if (!staffOnly(caller)) return refuse("not_staff");
      if (!authorize(caller.ctx, "workforce:manage", { orgId: caller.ctx.orgId }).allow)
        return refuse("access_policy");
      const r = await run(tx, await plan(tx));
      if (!r.ok) return refuse(r.reason, r.detail);
      return {
        status: 200,
        body: r,
        audit: { action: "workforce:manage", resource, outcome: "allowed" as const, after: body },
      };
    });

  app.secured("PUT", "/v1/workforce/teachers/:id/target", async (caller, req) => {
    const id = (req.params as { id: string }).id;
    const b = (req.body ?? {}) as { employment?: unknown; targetHours?: unknown };
    await manage(
      caller,
      "PUT /v1/workforce/teachers/:id/target",
      { id, body: req.body ?? null },
      { teacher: id },
      async (tx, p) => {
        if (!p.snap.teachers.has(id)) return { ok: false, reason: "not_found" };
        if (b.employment !== "full_time" && b.employment !== "part_time")
          return { ok: false, reason: "invalid", detail: "unknown employment" };
        const h = b.targetHours;
        if (typeof h !== "number" || !Number.isFinite(h) || h < 1 || h > 40 || (h * 2) % 1 !== 0)
          return { ok: false, reason: "invalid", detail: "target: 1–40 hours, in half hours" };
        await tx
          .insertInto("teacher_target")
          .values({
            org_id: caller.ctx.orgId,
            teacher_id: id,
            employment: b.employment,
            target_hours: h,
            updated_by: caller.ctx.principalId,
          })
          .onConflict((oc) =>
            oc.columns(["org_id", "teacher_id"]).doUpdateSet({
              employment: b.employment as Employment,
              target_hours: h,
              updated_by: caller.ctx.principalId,
              updated_at: new Date(caller.now()),
            }),
          )
          .execute();
        return { ok: true };
      },
    );
  });

  app.secured("PUT", "/v1/workforce/settings", async (caller, req) => {
    const b = (req.body ?? {}) as { underPct?: unknown; overPct?: unknown };
    await manage(
      caller,
      "PUT /v1/workforce/settings",
      req.body ?? null,
      { settings: true },
      async (tx) => {
        const bad = settingsIssue(b);
        if (bad) return { ok: false, reason: "invalid", detail: bad };
        const v = { under_pct: b.underPct as number, over_pct: b.overPct as number };
        await tx
          .insertInto("workforce_settings")
          .values({ org_id: caller.ctx.orgId, ...v, updated_by: caller.ctx.principalId })
          .onConflict((oc) =>
            oc.column("org_id").doUpdateSet({
              ...v,
              updated_by: caller.ctx.principalId,
              updated_at: new Date(caller.now()),
            }),
          )
          .execute();
        return { ok: true };
      },
    );
  });

  // ── suggestions (read only) ──
  app.secured("GET", "/v1/workforce/suggest/class/:id", async (caller, req, reply) => {
    if (!staffOnly(caller)) return reply.code(403).send({ error: "not_staff" });
    const id = (req.params as { id: string }).id;
    const out = await caller.tenant(async (tx) => {
      const p = await plan(tx);
      const cls = p.snap.classes.get(id);
      if (!cls) return null;
      const now = caller.now();
      // The class's own sessions (no substitute) move to the candidate.
      const own = (s: Sess) =>
        s.classId === id && s.state === "scheduled" && !s.substituteId && s.kind === "regular";
      const moving = windowSessions(p, now).filter(own);
      const future = p.snap.sessions.filter((s) => own(s) && s.at.getTime() > now);
      return candidates(
        p,
        now,
        moving.reduce((t, s) => t + hoursOf(p, s), 0),
        moving.length,
        cls.teacherId,
        (t) =>
          clashes(
            p.snap,
            now,
            future.map((s) => slotOf(p.snap, s, t)),
            new Set(future.map((s) => s.id)),
          ),
      );
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });

  app.secured("GET", "/v1/workforce/suggest/session/:id", async (caller, req, reply) => {
    if (!staffOnly(caller)) return reply.code(403).send({ error: "not_staff" });
    const id = (req.params as { id: string }).id;
    const out = await caller.tenant(async (tx) => {
      const p = await plan(tx);
      const s = p.snap.sessions.find((x) => x.id === id);
      if (!s) return null;
      const now = caller.now();
      const inWindow = s.at.getTime() >= now && s.at.getTime() < now + 7 * DAY;
      return candidates(
        p,
        now,
        inWindow ? hoursOf(p, s) : 0,
        inWindow ? 1 : 0,
        teacherOf(p.snap, s),
        (t) => clashes(p.snap, now, [slotOf(p.snap, s, t)], new Set([s.id])),
      );
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });
}
