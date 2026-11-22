/*
 * Workforce · Teacher Load — MOCK adapter (SYNTHETIC). Owner decisions 22/11 (see
 * packages/contracts/src/workforce.ts): load = teaching hours in the next 7 days from OGC's own
 * schedule; per-teacher targets set by staff; bands as % of target; SUGGEST ONLY — candidates are
 * ranked with load before → after and any clash, nothing is assigned, going over only warns.
 */
import type {
  Employment,
  LoadBand,
  LoadCandidate,
  LoadPoint,
  TeacherLoad,
  WorkforceOverview,
  WorkforcePort,
  WorkforceResult,
  WorkforceSettings,
} from "@ogc/contracts";
import { classTeachers, classes } from "../../fixtures/teaching";
import {
  TEACHER_BEN,
  TEACHER_KHANG,
  TEACHER_MIA,
  TEACHER_TARA,
  teachers,
} from "../../fixtures/personas";
import { refill, registerPersistent } from "./persist";
import { sessionStore, type StoredSession } from "./sessionStore";
import { findClashes, slotOf, teacherOfSession } from "./clashes";
import { allows } from "./accessPolicy";
import { staffOrgOf } from "./viewer";
import { withFault } from "./faults";
import { prepHoursOf } from "./mockStudioLinks";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
const refuse = (reason: Exclude<WorkforceResult, { ok: true }>["reason"], detail?: string) =>
  latency<WorkforceResult>({ ok: false, reason, ...(detail ? { detail } : {}) });
const DAY = 86_400_000;

export const DEFAULT_SETTINGS: WorkforceSettings = { underPct: 60, overPct: 100 };
// Synthetic targets: Tara is over, Ben meets, Mia and Khang have room (demo spread).
const SEED_TARGETS: Record<string, { employment: Employment; targetHours: number }> = {
  [TEACHER_TARA]: { employment: "part_time", targetHours: 2.5 },
  [TEACHER_BEN]: { employment: "part_time", targetHours: 4 },
  [TEACHER_MIA]: { employment: "part_time", targetHours: 4.5 },
  [TEACHER_KHANG]: { employment: "full_time", targetHours: 20 },
};

const targets = new Map<string, { employment: Employment; targetHours: number }>();
const settings = new Map<string, WorkforceSettings>(); // orgId → thresholds

function reset() {
  targets.clear();
  settings.clear();
  for (const [k, v] of Object.entries(SEED_TARGETS)) targets.set(k, { ...v });
}
sessionStore.onReset(reset);
export const __resetWorkforceForTests = reset;
registerPersistent("workforce", {
  dump: () => ({ targets, settings }),
  load: (raw) => {
    const r = raw as { targets?: unknown; settings?: unknown };
    refill(targets, r.targets);
    refill(settings, r.settings);
  },
});
reset();

const settingsOf = (org: string) => settings.get(org) ?? { ...DEFAULT_SETTINGS };
/** Forecast: the organization's teaching capacity — Σ teachers' target hours / week + thresholds. */
export function capacityOf(orgId: string): {
  hoursPerWeek: number;
  teachers: number;
  underPct: number;
  overPct: number;
} {
  const ts = teachers.filter((t) => t.orgId === orgId);
  const hours = ts.reduce((t, x) => t + (targets.get(x.id)?.targetHours ?? 0), 0);
  return { hoursPerWeek: hours, teachers: ts.length, ...settingsOf(orgId) };
}
const targetOf = (t: string) =>
  targets.get(t) ?? { employment: "part_time" as Employment, targetHours: 0 };
const hoursOf = (s: StoredSession) => sessionStore.classMeta(s.classId).durationMin / 60;
const round = (x: number) => Math.round(x * 10) / 10;
const className = (id: string) => classes.find((c) => c.id === id)?.name ?? "a class";

/** Scheduled sessions in the next 7 days (the load window). */
function windowSessions(now: number): StoredSession[] {
  return sessionStore
    .all()
    .filter(
      (s) => s.state === "scheduled" && Date.parse(s.at) >= now && Date.parse(s.at) < now + 7 * DAY,
    );
}

/** Forecast: teaching hours scheduled in the next 7 days at some centers (live). */
export function weeklyHoursAt(centerIds: string[], now = Date.now()): number {
  const at = (id: string) => classes.find((c) => c.id === id)?.centerId;
  return round(
    windowSessions(now)
      .filter((s) => centerIds.includes(at(s.classId) ?? ""))
      .reduce((t, s) => t + hoursOf(s), 0),
  );
}

function point(hours: number, sessions: number, target: number, s: WorkforceSettings): LoadPoint {
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

function loadOf(teacherId: string, org: string, now: number): TeacherLoad {
  const s = settingsOf(org);
  const mine = windowSessions(now).filter((x) => teacherOfSession(x) === teacherId);
  const groups = new Map<string, TeacherLoad["breakdown"][number]>();
  for (const x of mine) {
    const kind = x.kind === "makeup" ? "makeup" : x.substituteId ? "substitute" : "class";
    const key = `${x.classId}|${kind}`;
    const g = groups.get(key) ?? { label: className(x.classId), kind, sessions: 0, hours: 0 };
    g.sessions++;
    g.hours = round(g.hours + hoursOf(x));
    groups.set(key, g);
  }
  // Class courses: weekly prep hours staff set on a linked course count for the class teacher.
  const prep = prepHoursOf(teacherId).filter((p) =>
    classes.some((c) => c.id === p.classId && c.orgId === org),
  );
  for (const p of prep)
    groups.set(`${p.classId}|prep`, {
      label: p.className,
      kind: "prep",
      sessions: 0,
      hours: p.hours,
    });
  const hours = mine.reduce((t, x) => t + hoursOf(x), 0) + prep.reduce((t, p) => t + p.hours, 0);
  const tg = targetOf(teacherId);
  return {
    teacherId,
    name: teachers.find((t) => t.id === teacherId)?.name ?? "Teacher",
    employment: tg.employment,
    targetHours: tg.targetHours,
    classes: classes.filter((c) => c.orgId === org && classTeachers[c.id] === teacherId).length,
    breakdown: [...groups.values()],
    ...point(hours, mine.length, tg.targetHours, s),
  };
}

const orgTeachers = (org: string) => teachers.filter((t) => t.orgId === org);

function candidates(
  org: string,
  now: number,
  addHours: number,
  addSessions: number,
  exclude: string | null,
  clashFor: (teacherId: string) => string[],
): LoadCandidate[] {
  const s = settingsOf(org);
  const order = { meet: 0, under: 1, over: 2 } as const;
  return orgTeachers(org)
    .filter((t) => t.id !== exclude)
    .map((t) => {
      const L = loadOf(t.id, org, now);
      const before: LoadPoint = { hours: L.hours, sessions: L.sessions, pct: L.pct, band: L.band };
      const target = targetOf(t.id).targetHours;
      const after = point(before.hours + addHours, before.sessions + addSessions, target, s);
      const clashes = clashFor(t.id);
      const note = clashes.length
        ? "Schedule clash"
        : after.band === "over"
          ? `Would go over target (${after.pct ?? "—"}% of ${target} h)`
          : `Fits — ${after.pct ?? "—"}% of ${target} h after`;
      return { teacherId: t.id, name: t.name, before, after, clashes, note };
    })
    .sort(
      (a, b) =>
        Number(a.clashes.length > 0) - Number(b.clashes.length > 0) ||
        order[a.after.band] - order[b.after.band] ||
        (a.after.pct ?? 999) - (b.after.pct ?? 999),
    );
}

function settingsIssue(s: WorkforceSettings): string | null {
  if (!Number.isInteger(s.underPct) || !Number.isInteger(s.overPct))
    return "whole percentages only";
  if (s.underPct < 1 || s.underPct > 99) return "under: 1–99%";
  if (s.overPct < 100 || s.overPct > 200) return "over: 100–200%";
  return null;
}

export const mockWorkforce: WorkforcePort = {
  getOverview: (viewer) =>
    withFault("workforce.getOverview", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<WorkforceOverview | null>(null);
      const now = Date.now();
      const list = orgTeachers(org)
        .map((t) => loadOf(t.id, org, now))
        .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || a.name.localeCompare(b.name));
      const totalHours = round(list.reduce((t, x) => t + x.hours, 0));
      const totalTargetHours = round(list.reduce((t, x) => t + x.targetHours, 0));
      return latency<WorkforceOverview>({
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
        settings: settingsOf(org),
      });
    }),

  setTarget: (viewer, teacherId, employment, targetHours) =>
    withFault("workforce.setTarget", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      if (!allows(viewer, "workforce:manage")) return refuse("access_policy");
      if (!orgTeachers(org).some((t) => t.id === teacherId)) return refuse("not_found");
      if (employment !== "full_time" && employment !== "part_time")
        return refuse("invalid", "unknown employment");
      if (
        !Number.isFinite(targetHours) ||
        targetHours < 1 ||
        targetHours > 40 ||
        (targetHours * 2) % 1 !== 0
      )
        return refuse("invalid", "target: 1–40 hours, in half hours");
      targets.set(teacherId, { employment, targetHours });
      return latency<WorkforceResult>({ ok: true });
    }),

  updateSettings: (viewer, next) =>
    withFault("workforce.updateSettings", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      if (!allows(viewer, "workforce:manage")) return refuse("access_policy");
      const bad = settingsIssue(next);
      if (bad) return refuse("invalid", bad);
      settings.set(org, { underPct: next.underPct, overPct: next.overPct });
      return latency<WorkforceResult>({ ok: true });
    }),

  suggestForClass: (viewer, classId) =>
    withFault("workforce.suggestForClass", () => {
      const org = staffOrgOf(viewer);
      const cls = classes.find((c) => c.id === classId);
      if (!org || !cls || cls.orgId !== org) return latency<LoadCandidate[] | null>(null);
      const now = Date.now();
      // The class's own sessions in the window (no substitute) move to the candidate.
      const moving = windowSessions(now).filter(
        (s) => s.classId === classId && !s.substituteId && s.kind === "regular",
      );
      const future = sessionStore
        .all()
        .filter(
          (s) =>
            s.classId === classId &&
            s.state === "scheduled" &&
            !s.substituteId &&
            Date.parse(s.at) > now,
        );
      const add = moving.reduce((t, s) => t + hoursOf(s), 0);
      return latency(
        candidates(org, now, add, moving.length, classTeachers[classId] ?? null, (t) =>
          findClashes(
            future.map((s) => slotOf(s, t)),
            new Set(future.map((s) => s.id)),
          ),
        ),
      );
    }),

  suggestForSession: (viewer, sessionId) =>
    withFault("workforce.suggestForSession", () => {
      const org = staffOrgOf(viewer);
      const s = sessionStore.get(sessionId);
      const cls = s ? classes.find((c) => c.id === s.classId) : undefined;
      if (!org || !s || !cls || cls.orgId !== org) return latency<LoadCandidate[] | null>(null);
      const now = Date.now();
      const inWindow = Date.parse(s.at) >= now && Date.parse(s.at) < now + 7 * DAY;
      return latency(
        candidates(
          org,
          now,
          inWindow ? hoursOf(s) : 0,
          inWindow ? 1 : 0,
          teacherOfSession(s),
          (t) => findClashes([slotOf(s, t)], new Set([s.id])),
        ),
      );
    }),

  suggestForNewClass: (viewer, weeklyMinutes) =>
    withFault("workforce.suggestForNewClass", () => {
      const org = staffOrgOf(viewer);
      if (!org || !Number.isFinite(weeklyMinutes) || weeklyMinutes < 0 || weeklyMinutes > 40 * 60)
        return latency<LoadCandidate[] | null>(null);
      // Clashes for a new class are checked by the wizard's Review step (it knows the dates).
      return latency(candidates(org, Date.now(), weeklyMinutes / 60, 0, null, () => []));
    }),
};
