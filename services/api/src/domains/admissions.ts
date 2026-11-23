/*
 * Admissions on the Platform API — the rules of the demo's mock adapter
 * (apps/web/src/lib/adapters/mockAdmissions.ts, owner decisions 22/11), on PostgreSQL:
 *  - ONE pipeline for every lead; staff act within the centers their policy allows
 *    (admissions:manage, IIOS-decided);
 *  - a MINIMAL synthetic profile: name, course, center, source, channel, needs, a short note — no
 *    phone numbers or e-mail addresses (refused), no finances, no visa status;
 *  - an explainable, staff-tunable score: five parts, each with its reason, no hidden model;
 *  - dashboard rates carry numerator and denominator and never exceed 100% ("reached" counts the
 *    furthest stage a lead ever reached, so a lost lead keeps what it got to);
 *  - "offer" (first invoice issued) and "enrolled" (paid in full) are set by Billing only — see
 *    `attachFirstInvoice` / `markLeadPaid`, for the Billing slice.
 * Stage history and activities are append-only for the application role (insert only).
 */
import { sql } from "kysely";
import {
  authorize,
  FUNNEL,
  LEARNING_NEEDS,
  MANUAL_STAGES,
  OPEN_STAGES,
  SCORE_KEYS,
} from "@ogc/contracts";
import type {
  AdmissionsDashboard,
  AdmissionsRefusal,
  AdmissionsResult,
  ContactChannel,
  Lead,
  LeadActivity,
  LeadActivityKind,
  LeadSource,
  LeadStage,
  LearningNeed,
  Ratio,
  ScoreBand,
  ScoreKey,
  ScorePart,
  ScoringSettings,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const DEFAULT_SETTINGS: ScoringSettings = {
  max: { source: 25, course_fit: 20, engagement: 20, recency: 20, progress: 15 },
  hotAt: 70,
  warmAt: 40,
  staleDays: 7,
};

interface StoredLead {
  id: string;
  learnerName: string;
  courseCode: string;
  centerId: string;
  source: LeadSource;
  referrerName: string | null;
  campaignId: string | null;
  channel: ContactChannel | null;
  needs: LearningNeed[];
  note: string;
  stage: LeadStage;
  history: { stage: LeadStage; at: string; by: string }[]; // oldest first
  assignedTo: string | null;
  activities: LeadActivity[]; // oldest first
  invoiceNo: string | null;
  firstPaymentVnd: number | null;
  lostReason: string | null;
  createdAt: string;
}

interface Book {
  leads: StoredLead[];
  settings: ScoringSettings;
  centers: Map<string, string>;
  courseCodes: string[];
  classAt: Set<string>; // `${centerId}|${courseCode}` — a class of that course runs there
  staff: Map<string, string>; // principal → display name
}

async function loadBook(tx: TenantTx): Promise<Book> {
  const [leads, history, acts, settings, centers, courses, classes, staff] = await Promise.all([
    tx.selectFrom("lead").selectAll().execute(),
    tx.selectFrom("lead_history").selectAll().orderBy("lead_id").orderBy("seq").execute(),
    tx.selectFrom("lead_activity").selectAll().orderBy("lead_id").orderBy("seq").execute(),
    tx.selectFrom("admissions_settings").selectAll().executeTakeFirst(),
    tx.selectFrom("center").select(["id", "name"]).execute(),
    tx.selectFrom("course").select(["id", "code"]).execute(),
    tx.selectFrom("class").select(["center_id", "course_id"]).execute(),
    tx.selectFrom("staff_member").select(["principal_id", "display_name"]).execute(),
  ]);
  const codeOf = new Map(courses.map((c) => [c.id, c.code]));
  return {
    leads: leads.map((l) => ({
      id: l.id,
      learnerName: l.learner_name,
      courseCode: l.course_code,
      centerId: l.center_id,
      source: l.source,
      referrerName: l.referrer_name,
      campaignId: l.campaign_id,
      channel: l.channel,
      needs: l.needs as LearningNeed[],
      note: l.note,
      stage: l.stage,
      history: history
        .filter((h) => h.lead_id === l.id)
        .map((h) => ({ stage: h.stage, at: new Date(h.at).toISOString(), by: h.by_name })),
      assignedTo: l.assigned_to,
      activities: acts
        .filter((a) => a.lead_id === l.id)
        .map((a) => ({
          id: `${l.id}-A${a.seq}`,
          at: new Date(a.at).toISOString(),
          by: a.by_name,
          kind: a.kind,
          text: a.text,
        })),
      invoiceNo: l.invoice_no,
      firstPaymentVnd: l.first_payment_vnd === null ? null : Number(l.first_payment_vnd),
      lostReason: l.lost_reason,
      createdAt: new Date(l.created_at).toISOString(),
    })),
    settings: settings
      ? {
          max: settings.max as ScoringSettings["max"],
          hotAt: settings.hot_at,
          warmAt: settings.warm_at,
          staleDays: settings.stale_days,
        }
      : structuredClone(DEFAULT_SETTINGS),
    centers: new Map(centers.map((c) => [c.id, c.name])),
    courseCodes: courses.map((c) => c.code).sort(),
    classAt: new Set(
      classes.filter((c) => c.course_id).map((c) => `${c.center_id}|${codeOf.get(c.course_id!)}`),
    ),
    staff: new Map(staff.map((s) => [s.principal_id, s.display_name])),
  };
}

// ── score + derived fields (the demo's) ──────────────────────────────────────────────────────
const SOURCE_SHARE: Record<LeadSource, number> = {
  referral: 1,
  walk_in: 0.8,
  event: 0.6,
  website: 0.4,
  phone: 0.4,
};
const SOURCE_LABEL: Record<LeadSource, string> = {
  referral: "a referral",
  walk_in: "a walk-in",
  event: "an event",
  website: "the website",
  phone: "a phone enquiry",
};
const PROGRESS_SHARE: Record<LeadStage, number> = {
  new: 0,
  assigned: 0.2,
  contacted: 0.4,
  placement: 0.7,
  offer: 1,
  enrolled: 1,
  lost: 0,
};
const STAGE_WORDS: Record<LeadStage, string> = {
  new: "new",
  assigned: "assigned",
  contacted: "contacted",
  placement: "placement test done",
  offer: "first invoice issued",
  enrolled: "enrolled",
  lost: "lost",
};
const stageIndex = (s: LeadStage) => FUNNEL.indexOf(s);
const reachedIndex = (l: StoredLead) =>
  Math.max(0, ...l.history.map((h) => stageIndex(h.stage)).filter((i) => i >= 0));
const lastTouchOf = (l: StoredLead) =>
  [l.createdAt, ...l.history.map((h) => h.at), ...l.activities.map((a) => a.at)].sort().pop()!;

function firstResponseHours(l: StoredLead): number | null {
  const touches = [
    ...l.activities.map((a) => a.at),
    ...l.history.filter((h) => stageIndex(h.stage) >= stageIndex("contacted")).map((h) => h.at),
  ].sort();
  if (!touches.length) return null;
  return Math.max(
    0,
    Math.round(((Date.parse(touches[0]) - Date.parse(l.createdAt)) / HOUR) * 10) / 10,
  );
}

function scoreOf(b: Book, l: StoredLead, now: number) {
  const s = b.settings;
  const parts: ScorePart[] = [];
  const part = (key: ScoreKey, share: number, why: string) =>
    parts.push({ key, points: Math.round(s.max[key] * share), max: s.max[key], why });
  part("source", SOURCE_SHARE[l.source], `Came from ${SOURCE_LABEL[l.source]}`);
  const here = b.classAt.has(`${l.centerId}|${l.courseCode}`);
  const elsewhere = [...b.classAt].some((k) => k.endsWith(`|${l.courseCode}`));
  part(
    "course_fit",
    here ? 1 : elsewhere ? 0.5 : 0,
    here
      ? `${l.courseCode} has a class at this center`
      : elsewhere
        ? `${l.courseCode} runs at another center only`
        : `No ${l.courseCode} class yet`,
  );
  const n = l.activities.length;
  part("engagement", Math.min(n, 4) / 4, `${n} logged ${n === 1 ? "activity" : "activities"}`);
  const days = Math.floor((now - Date.parse(lastTouchOf(l))) / DAY);
  part(
    "recency",
    days <= 2 ? 1 : days <= 7 ? 0.5 : days <= 14 ? 0.25 : 0,
    days === 0 ? "Touched today" : `Last touched ${days} day${days === 1 ? "" : "s"} ago`,
  );
  part("progress", PROGRESS_SHARE[l.stage], `Stage: ${STAGE_WORDS[l.stage]}`);
  const total = parts.reduce((t, p) => t + p.points, 0);
  const band: ScoreBand = total >= s.hotAt ? "hot" : total >= s.warmAt ? "warm" : "cold";
  return { total, band, parts };
}

const isOpen = (l: StoredLead) => OPEN_STAGES.includes(l.stage);
const isStale = (l: StoredLead, s: ScoringSettings, now: number) =>
  isOpen(l) && now - Date.parse(lastTouchOf(l)) > s.staleDays * DAY;

function view(b: Book, l: StoredLead, now: number): Lead {
  return {
    id: l.id,
    learnerName: l.learnerName,
    courseCode: l.courseCode,
    centerId: l.centerId,
    centerName: b.centers.get(l.centerId) ?? "Unknown center",
    source: l.source,
    referredBy: l.referrerName,
    campaignId: l.campaignId,
    channel: l.channel,
    needs: [...l.needs],
    note: l.note,
    stage: l.stage,
    stageHistory: l.history.map((h) => ({ ...h })),
    assignedTo: l.assignedTo
      ? { principalId: l.assignedTo, name: b.staff.get(l.assignedTo) ?? l.assignedTo }
      : null,
    activities: [...l.activities].reverse(),
    invoiceNo: l.invoiceNo,
    firstPaymentVnd: l.firstPaymentVnd,
    lostReason: l.lostReason,
    createdAt: l.createdAt,
    lastTouchAt: lastTouchOf(l),
    firstResponseHours: firstResponseHours(l),
    stale: isStale(l, b.settings, now),
    score: scoreOf(b, l, now),
  };
}

const ratio = (reached: number, of: number): Ratio => ({
  reached,
  of,
  pct: of > 0 ? Math.round((reached / of) * 1000) / 10 : null,
});
const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((t, x) => t + x, 0) / xs.length) * 10) / 10 : null;

// ── validation (the demo's) ──────────────────────────────────────────────────────────────────
const CHANNELS: ContactChannel[] = ["zalo", "phone", "email", "in_person"];
const SOURCES: LeadSource[] = ["walk_in", "website", "event", "phone"];
const KINDS: LeadActivityKind[] = ["call", "message", "meeting", "note"];

function draftIssue(b: Book, d: Record<string, unknown>): string | null {
  if (typeof d.learnerName !== "string" || typeof d.note !== "string" || !Array.isArray(d.needs))
    return "malformed lead";
  const name = d.learnerName.trim();
  if (name.length < 2 || name.length > 60) return "name must be 2–60 characters";
  // Synthetic data only: no digits (phone numbers), no e-mail addresses in names or notes.
  if (/\d{4,}|@/.test(name) || /\d{6,}|@/.test(d.note))
    return "no phone numbers or e-mail addresses";
  if (!b.courseCodes.includes(d.courseCode as string)) return "unknown course";
  if (!b.centers.has(d.centerId as string)) return "unknown center";
  if (!SOURCES.includes(d.source as LeadSource)) return "unknown source";
  if (d.channel !== null && !CHANNELS.includes(d.channel as ContactChannel))
    return "unknown channel";
  if ((d.needs as unknown[]).some((n) => !LEARNING_NEEDS.includes(n as LearningNeed)))
    return "unknown learning need";
  if (d.note.length > 280) return "note: at most 280 characters";
  return null;
}

function settingsIssue(s: ScoringSettings): string | null {
  if (!s || typeof s !== "object" || !s.max || typeof s.max !== "object")
    return "malformed settings";
  for (const k of SCORE_KEYS) {
    const v = s.max[k];
    if (!Number.isInteger(v) || v < 0 || v > 50) return `${k}: 0–50 points`;
  }
  if (Object.keys(s.max).some((k) => !SCORE_KEYS.includes(k as ScoreKey)))
    return "unknown score part";
  const sum = SCORE_KEYS.reduce((t, k) => t + s.max[k], 0);
  if (sum !== 100) return `the parts must add up to 100 (now ${sum})`;
  if (
    !Number.isInteger(s.warmAt) ||
    !Number.isInteger(s.hotAt) ||
    s.warmAt < 1 ||
    s.hotAt > 99 ||
    s.warmAt >= s.hotAt
  )
    return "warm must be below hot, both 1–99";
  if (!Number.isInteger(s.staleDays) || s.staleDays < 1 || s.staleDays > 60)
    return "stale after 1–60 days";
  return null;
}

// ── Billing hooks (the Billing slice calls these inside its own transaction) ─────────────────
async function addHistory(
  tx: TenantTx,
  orgId: string,
  leadId: string,
  stage: LeadStage,
  at: Date,
  by: string,
) {
  await sql`insert into lead_history (org_id, lead_id, seq, stage, at, by_name)
            select ${orgId}, ${leadId}, coalesce(max(seq), 0) + 1, ${stage}, ${at}, ${by}
              from lead_history where org_id = ${orgId} and lead_id = ${leadId}`.execute(tx);
}
/** First invoice issued → "offer"; voided (null) → back to "placement". */
export async function attachFirstInvoice(
  tx: TenantTx,
  orgId: string,
  leadId: string,
  invoiceNo: string | null,
  at: Date,
  by = "Billing",
) {
  const l = await tx
    .selectFrom("lead")
    .select(["stage"])
    .where("id", "=", leadId)
    .executeTakeFirst();
  if (!l) return;
  await tx.updateTable("lead").set({ invoice_no: invoiceNo }).where("id", "=", leadId).execute();
  const next =
    invoiceNo && l.stage === "placement"
      ? "offer"
      : !invoiceNo && l.stage === "offer"
        ? "placement"
        : null;
  if (next) {
    await tx.updateTable("lead").set({ stage: next }).where("id", "=", leadId).execute();
    await addHistory(tx, orgId, leadId, next, at, by);
  }
}
/** Why this lead cannot go to a partner, or null (open, and no first invoice waiting). */
export async function canReferOut(tx: TenantTx, leadId: string): Promise<string | null> {
  const l = await tx
    .selectFrom("lead")
    .select(["stage", "invoice_no"])
    .where("id", "=", leadId)
    .executeTakeFirst();
  if (!l) return "lead not found";
  if (l.stage === "offer")
    return `first invoice ${l.invoice_no} is open — void it in Billing first`;
  if (!OPEN_STAGES.includes(l.stage)) return "the lead is closed";
  return null;
}
/** Partner Commissions: the lead closes here as "Referred to partner: <name>". */
export async function referLeadOut(
  tx: TenantTx,
  orgId: string,
  leadId: string,
  partnerName: string,
  at: Date,
  by: string,
) {
  await tx
    .updateTable("lead")
    .set({ stage: "lost", lost_reason: `Referred to partner: ${partnerName}`.slice(0, 200) })
    .where("id", "=", leadId)
    .execute();
  await addHistory(tx, orgId, leadId, "lost", at, by);
}
/** The first invoice is paid in full: enrolled, with the amount from the invoice. */
export async function markLeadPaid(
  tx: TenantTx,
  orgId: string,
  leadId: string,
  amountVnd: number,
  at: Date,
  by = "Billing",
) {
  const l = await tx
    .selectFrom("lead")
    .select(["stage"])
    .where("id", "=", leadId)
    .executeTakeFirst();
  if (!l || l.stage !== "offer") return;
  await tx
    .updateTable("lead")
    .set({ stage: "enrolled", first_payment_vnd: amountVnd })
    .where("id", "=", leadId)
    .execute();
  await addHistory(tx, orgId, leadId, "enrolled", at, by);
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────
const STATUS: Record<AdmissionsRefusal, number> = {
  not_staff: 403,
  access_policy: 403,
  not_found: 404,
  invalid: 422,
  invalid_step: 409,
};

export function registerAdmissions(app: Api): void {
  const isStaff = (c: Caller) => c.ctx.role === "staff";
  const mayAt = (c: Caller, centerId?: string) =>
    authorize(c.ctx, "admissions:manage", { orgId: c.ctx.orgId, ...(centerId ? { centerId } : {}) })
      .allow;
  const nameOf = (b: Book, c: Caller) => b.staff.get(c.ctx.principalId) ?? c.ctx.principalId;

  const read = <T>(url: string, fn: (b: Book, caller: Caller, now: number) => T) =>
    app.secured("GET", url, async (caller, _req, reply) => {
      if (!isStaff(caller)) return reply.code(403).send({ error: "not_staff" });
      return caller.tenant(async (tx) => fn(await loadBook(tx), caller, caller.now()));
    });

  /** A staff write: serialised per organization, idempotent, audited. */
  const write = (
    method: "POST" | "PUT",
    url: string,
    run: (
      tx: TenantTx,
      b: Book,
      caller: Caller,
      body: Record<string, unknown>,
      params: Record<string, string>,
      now: Date,
    ) => Promise<AdmissionsResult>,
  ) =>
    app.secured(method, url, async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = req.params as Record<string, string>;
      await caller.write<AdmissionsResult>(`${method} ${url}`, { params, body }, async (tx) => {
        const resource = { lead: params.id ?? null };
        const out = async (): Promise<AdmissionsResult> => {
          if (!isStaff(caller)) return { ok: false, reason: "not_staff" };
          await sql`select pg_advisory_xact_lock(hashtext('admissions:' || ${caller.ctx.orgId}))`.execute(
            tx,
          );
          return run(tx, await loadBook(tx), caller, body, params, new Date(caller.now()));
        };
        const r = await out();
        return {
          status: r.ok ? 200 : STATUS[r.reason],
          body: r,
          audit: {
            action: "admissions:manage",
            resource,
            outcome: r.ok ? ("allowed" as const) : ("denied" as const),
            ...(r.ok ? { after: body } : { reason: r.reason }),
          },
        };
      });
    });

  /** The lead, if this staff member may act on it. */
  const forWrite = (b: Book, caller: Caller, id: string): StoredLead | AdmissionsResult => {
    const l = b.leads.find((x) => x.id === id);
    if (!l) return { ok: false, reason: "not_found" };
    if (!mayAt(caller, l.centerId)) return { ok: false, reason: "access_policy" };
    return l;
  };
  const refusal = (x: StoredLead | AdmissionsResult): x is AdmissionsResult => "ok" in x;
  const counselors = (b: Book) =>
    [...b.staff].map(([principalId, name]) => ({ principalId, name }));

  read("/v1/admissions/options", (b, caller) => ({
    centers: [...b.centers].filter(([id]) => mayAt(caller, id)).map(([id, name]) => ({ id, name })),
    courseCodes: b.courseCodes,
  }));
  read("/v1/admissions/counselors", (b) => counselors(b));
  read("/v1/admissions/settings", (b) => b.settings);

  read("/v1/admissions/leads", (b, caller, now) =>
    b.leads
      .filter((l) => mayAt(caller, l.centerId))
      .map((l) => view(b, l, now))
      .sort((a, c) => c.score.total - a.score.total || (a.createdAt < c.createdAt ? 1 : -1)),
  );

  read("/v1/admissions/dashboard", (b, caller, now): AdmissionsDashboard => {
    const list = b.leads.filter((l) => mayAt(caller, l.centerId));
    const s = b.settings;
    const reached = (i: number) => list.filter((l) => reachedIndex(l) >= i).length;
    const open = list.filter(isOpen);
    const views = open.map((l) => view(b, l, now));
    const fr = list.map(firstResponseHours).filter((x): x is number => x !== null);
    const sources: LeadSource[] = ["referral", "walk_in", "website", "event", "phone"];
    return {
      total: list.length,
      open: open.length,
      enrolled: list.filter((l) => l.stage === "enrolled").length,
      lost: list.filter((l) => l.stage === "lost").length,
      byStage: [...FUNNEL, "lost" as LeadStage].map((stage) => ({
        stage,
        count: list.filter((l) => l.stage === stage).length,
      })),
      conversions: FUNNEL.slice(1).map((to, i) => ({
        from: FUNNEL[i],
        to,
        ...ratio(reached(i + 1), reached(i)),
      })),
      leadToEnrolled: ratio(reached(stageIndex("enrolled")), list.length),
      firstResponse: { avgHours: avg(fr), measured: fr.length, of: list.length },
      stale: list.filter((l) => isStale(l, s, now)).length,
      staleDays: s.staleDays,
      bands: {
        hot: views.filter((v) => v.score.band === "hot").length,
        warm: views.filter((v) => v.score.band === "warm").length,
        cold: views.filter((v) => v.score.band === "cold").length,
      },
      bySource: sources.map((source) => {
        const xs = list.filter((l) => l.source === source);
        return {
          source,
          leads: xs.length,
          ...ratio(xs.filter((l) => l.stage === "enrolled").length, xs.length),
        };
      }),
      counselors: counselors(b).map((m) => {
        const mine = list.filter((l) => l.assignedTo === m.principalId);
        const frs = mine.map(firstResponseHours).filter((x): x is number => x !== null);
        const enrolled = mine.filter((l) => l.stage === "enrolled").length;
        return {
          principalId: m.principalId,
          name: m.name,
          assigned: mine.length,
          contacted: mine.filter((l) => reachedIndex(l) >= stageIndex("contacted")).length,
          enrolled,
          conversion: ratio(enrolled, mine.length),
          avgFirstResponseHours: avg(frs),
          stale: mine.filter((l) => isStale(l, s, now)).length,
        };
      }),
    };
  });

  write("POST", "/v1/admissions/leads", async (tx, b, caller, d, _p, now) => {
    if (typeof d.centerId !== "string" || !b.centers.has(d.centerId))
      return { ok: false, reason: "invalid", detail: "unknown center" };
    if (!mayAt(caller, d.centerId)) return { ok: false, reason: "access_policy" };
    const bad = draftIssue(b, d);
    if (bad) return { ok: false, reason: "invalid", detail: bad };
    const next = Math.max(0, ...b.leads.map((l) => Number(l.id.replace(/^ADM-/, "")) || 0)) + 1;
    const id = `ADM-${next}`;
    await tx
      .insertInto("lead")
      .values({
        org_id: caller.ctx.orgId,
        id,
        learner_name: (d.learnerName as string).trim(),
        course_code: d.courseCode as string,
        center_id: d.centerId,
        source: d.source as Exclude<LeadSource, "referral">,
        referrer_name: null,
        campaign_id: null,
        channel: d.channel as ContactChannel | null,
        needs: [...new Set(d.needs as string[])],
        note: (d.note as string).trim(),
        stage: "new",
        assigned_to: null,
        invoice_no: null,
        first_payment_vnd: null,
        lost_reason: null,
        created_at: now,
      })
      .execute();
    await addHistory(tx, caller.ctx.orgId, id, "new", now, nameOf(b, caller));
    return { ok: true, id };
  });

  write("PUT", "/v1/admissions/leads/:id/assign", async (tx, b, caller, d, p, now) => {
    const l = forWrite(b, caller, p.id);
    if (refusal(l)) return l;
    if (typeof d.principalId !== "string" || !b.staff.has(d.principalId))
      return { ok: false, reason: "invalid", detail: "not a staff member of this organization" };
    if (!isOpen(l)) return { ok: false, reason: "invalid_step", detail: "the lead is closed" };
    await tx
      .updateTable("lead")
      .set({ assigned_to: d.principalId })
      .where("id", "=", l.id)
      .execute();
    if (l.stage === "new") {
      await tx.updateTable("lead").set({ stage: "assigned" }).where("id", "=", l.id).execute();
      await addHistory(tx, caller.ctx.orgId, l.id, "assigned", now, nameOf(b, caller));
    }
    return { ok: true };
  });

  write("PUT", "/v1/admissions/leads/:id/stage", async (tx, b, caller, d, p, now) => {
    const l = forWrite(b, caller, p.id);
    if (refusal(l)) return l;
    const stage = d.stage as LeadStage;
    if (!MANUAL_STAGES.includes(stage))
      return {
        ok: false,
        reason: "invalid_step",
        detail: "offer and enrolled follow the first invoice (Billing)",
      };
    if (l.stage === "enrolled")
      return { ok: false, reason: "invalid_step", detail: "already enrolled" };
    if (l.stage === "offer")
      return {
        ok: false,
        reason: "invalid_step",
        detail: `first invoice ${l.invoiceNo} is open — void it in Billing first`,
      };
    if (stage === l.stage)
      return { ok: false, reason: "invalid_step", detail: "already at this stage" };
    if (stage === "assigned" && !l.assignedTo)
      return { ok: false, reason: "invalid", detail: "assign a counselor first" };
    const reason = typeof d.reason === "string" ? d.reason.trim() : "";
    if (stage === "lost" && reason.length < 3)
      return { ok: false, reason: "invalid", detail: "give a reason" };
    await tx
      .updateTable("lead")
      .set({ stage, lost_reason: stage === "lost" ? reason.slice(0, 200) : null })
      .where("id", "=", l.id)
      .execute();
    await addHistory(tx, caller.ctx.orgId, l.id, stage, now, nameOf(b, caller));
    return { ok: true };
  });

  write("POST", "/v1/admissions/leads/:id/activities", async (tx, b, caller, d, p, now) => {
    const l = forWrite(b, caller, p.id);
    if (refusal(l)) return l;
    if (!KINDS.includes(d.kind as LeadActivityKind))
      return { ok: false, reason: "invalid", detail: "unknown kind" };
    const t = typeof d.text === "string" ? d.text.trim() : "";
    if (t.length < 2 || t.length > 280)
      return { ok: false, reason: "invalid", detail: "2–280 characters" };
    if (/\d{6,}|@/.test(t))
      return { ok: false, reason: "invalid", detail: "no phone numbers or e-mail addresses" };
    await sql`insert into lead_activity (org_id, lead_id, seq, kind, text, at, by_name)
              select ${caller.ctx.orgId}, ${l.id}, coalesce(max(seq), 0) + 1, ${d.kind as string}, ${t}, ${now}, ${nameOf(b, caller)}
                from lead_activity where org_id = ${caller.ctx.orgId} and lead_id = ${l.id}`.execute(
      tx,
    );
    return { ok: true };
  });

  write("PUT", "/v1/admissions/settings", async (tx, _b, caller, d) => {
    if (!mayAt(caller)) return { ok: false, reason: "access_policy" };
    const next = d as unknown as ScoringSettings;
    const bad = settingsIssue(next);
    if (bad) return { ok: false, reason: "invalid", detail: bad };
    const v = {
      max: JSON.stringify(next.max),
      hot_at: next.hotAt,
      warm_at: next.warmAt,
      stale_days: next.staleDays,
    };
    await tx
      .insertInto("admissions_settings")
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
  });
}
