/*
 * Business Forecast — MOCK adapter (SYNTHETIC). Owner decisions 22/11 (see
 * packages/contracts/src/forecast.ts). Plain statistics, every step visible:
 *   seasonal index s[month]  = mean over the two history years of (month ÷ that year's mean),
 *                              normalized to average 1.00;
 *   growth g                 = last 12 months ÷ the 12 before − 1, capped at ±MAX_GROWTH_PCT;
 *   level L                  = mean of the last 12 months with the season taken out;
 *   forecast(month)          = L × (1 + g)^(years from the middle of the last 12 months) × s[month];
 *   anchor                   = students and hours / week start from today's live figures;
 *   ± range                  = the same model's mean absolute error on the last 12 months (≥ 5%).
 * It reads, never acts. Money only for viewers with billing access at every center in their scope.
 */
import type {
  ForecastMetric,
  ForecastOverview,
  ForecastPort,
  ForecastResult,
  ForecastSettings,
  ForecastUnit,
  IiosGrantedContext,
  LeadStage,
  MetricForecast,
} from "@ogc/contracts";
import { OPEN_STAGES, SCENARIOS, settingsIssue } from "@ogc/contracts";
import { centers } from "../../fixtures/directory";
import { classes, rosters } from "../../fixtures/teaching";
import {
  HISTORY_MONTHS,
  calMonth,
  historyOf,
  monthAdd,
  type CenterHistory,
} from "../../fixtures/forecastHistory";
import { allows, centerScope, inScope } from "./accessPolicy";
import { staffOrgOf } from "./viewer";
import { centerToday, openBalancesOf } from "./mockBilling";
import { leadsOfOrg } from "./mockAdmissions";
import { capacityOf, weeklyHoursAt } from "./mockWorkforce";
import { withFault } from "./faults";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export const MAX_GROWTH_PCT = 25;
export const MIN_ERROR_PCT = 5;
/** Chance that an open lead at each stage enrols — default weights, shown on the page. */
export const STAGE_WEIGHT: Partial<Record<LeadStage, number>> = {
  new: 0.1,
  assigned: 0.15,
  contacted: 0.25,
  placement: 0.45,
  offer: 0.7,
};

/** Synthetic default figures (slice 2), sized to the demo center — not real costs. */
export const DEFAULT_FORECAST_SETTINGS: ForecastSettings = {
  costs: { fixedMonthlyVnd: 10_000_000, variablePct: 10, teacherHourlyVnd: 150_000 },
  scenarios: {
    conservative: { growthAdjPct: -10, conversionAdjPct: -15, tuitionAdjPct: 0 },
    base: { growthAdjPct: 0, conversionAdjPct: 0, tuitionAdjPct: 0 },
    optimistic: { growthAdjPct: 5, conversionAdjPct: 10, tuitionAdjPct: 5 },
  },
};
const settings = new Map<string, ForecastSettings>(); // orgId → saved figures
const reset = () => settings.clear();
sessionStore.onReset(reset);
export const __resetForecastForTests = reset;
registerPersistent("forecast", {
  dump: () => ({ settings }),
  load: (raw) => refill(settings, (raw as { settings?: unknown }).settings),
});
const settingsOf = (org: string): ForecastSettings =>
  structuredClone(settings.get(org) ?? DEFAULT_FORECAST_SETTINGS);
const refuse = (reason: Exclude<ForecastResult, { ok: true }>["reason"], detail?: string) =>
  latency<ForecastResult>({ ok: false, reason, ...(detail ? { detail } : {}) });
/** Slice 2 needs the whole organization in view (fixed costs are organization-wide) + money. */
const wholeOrgWithMoney = (viewer: IiosGrantedContext, org: string) =>
  centerScope(viewer, "forecast:view") === "any" &&
  centers
    .filter((c) => c.orgId === org)
    .every((c) => allows(viewer, "billing:manage", { centerId: c.id }));

const META: Record<ForecastMetric, { unit: ForecastUnit; aggregate: "sum" | "avg" }> = {
  leads: { unit: "people", aggregate: "sum" },
  enrolments: { unit: "people", aggregate: "sum" },
  active: { unit: "people", aggregate: "avg" },
  hours: { unit: "hours_per_week", aggregate: "avg" },
  collected: { unit: "vnd", aggregate: "sum" },
};
const roundFor = (unit: ForecastUnit) => (x: number) =>
  unit === "vnd" ? Math.round(x / 1000) * 1000 : Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/** The model on one (already summed) monthly history. Exported for tests. */
export function forecastSeries(
  metric: ForecastMetric,
  months: string[], // history months, oldest first (24)
  h: number[],
  currentMonth: string,
  anchor: { value: number; label: string } | null,
): MetricForecast {
  const { unit, aggregate } = META[metric];
  const r = roundFor(unit);
  const n = h.length;
  const last = h.slice(n - 12);
  const prior = h.slice(n - 24, n - 12);

  // Seasonal indices by calendar month.
  const ratios: number[][] = Array.from({ length: 12 }, () => []);
  for (const [offset, block] of [
    [n - 24, prior],
    [n - 12, last],
  ] as const) {
    const m = mean(block);
    if (m <= 0) continue;
    block.forEach((x, j) => ratios[calMonth(months[offset + j])].push(x / m));
  }
  let seasonal = ratios.map((xs) => (xs.length ? mean(xs) : 1));
  const sm = mean(seasonal);
  seasonal = seasonal.map((x) => (sm > 0 ? x / sm : 1));

  const rawGrowth = sum(prior) > 0 ? sum(last) / sum(prior) - 1 : 0;
  const cap = MAX_GROWTH_PCT / 100;
  const g = Math.max(-cap, Math.min(cap, rawGrowth));
  const mid = n - 6.5; // middle of the last 12 months (index)
  const sOf = (ym: string) => seasonal[calMonth(ym)];
  const deseason = last
    .map((x, j) => ({ x, s: sOf(months[n - 12 + j]) }))
    .filter((p) => p.s > 0)
    .map((p) => p.x / p.s);
  let level = mean(deseason);
  const at = (i: number, ym: string) => level * (1 + g) ** ((i - mid) / 12) * sOf(ym);

  // In-sample error on the last 12 months → the ± range.
  const errs = last
    .map((x, j) => ({ x, f: at(n - 12 + j, months[n - 12 + j]) }))
    .filter((p) => p.x > 0)
    .map((p) => Math.abs(p.x - p.f) / p.x);
  const errorPct = Math.max(MIN_ERROR_PCT, Math.round(mean(errs) * 100));

  // Anchor: the current month starts from today's live figure.
  if (anchor && anchor.value > 0 && sOf(currentMonth) > 0)
    level = anchor.value / ((1 + g) ** ((n - mid) / 12) * sOf(currentMonth));

  const e = errorPct / 100;
  const forecastMonths = Array.from({ length: 12 }, (_, k) => {
    const ym = monthAdd(currentMonth, k);
    const f = Math.max(0, at(n + k, ym));
    return {
      month: ym,
      forecast: r(f),
      low: r(f * (1 - e)),
      high: r(f * (1 + e)),
      lastYear: h[n - 12 + k], // the same calendar month, one year earlier
    };
  });
  const agg = (xs: number[]) => (aggregate === "sum" ? sum(xs) : mean(xs));
  const l12 = agg(last);
  const p12 = agg(prior);
  return {
    metric,
    unit,
    aggregate,
    months: forecastMonths,
    trailing: {
      last12: r(l12),
      prior12: r(p12),
      yoyPct: p12 > 0 ? Math.round(((l12 - p12) / p12) * 1000) / 10 : null,
    },
    assumptions: {
      growthPct: Math.round(g * 1000) / 10,
      rawGrowthPct: Math.round(rawGrowth * 1000) / 10,
      capped: g !== rawGrowth,
      seasonal: seasonal.map((x) => Math.round(x * 100) / 100),
      errorPct,
      anchor: anchor && anchor.value > 0 ? anchor.label : null,
    },
  };
}

export const mockForecast: ForecastPort = {
  getOverview: (viewer: IiosGrantedContext) =>
    withFault("forecast.overview", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<ForecastOverview | null>(null);
      const scope = centerScope(viewer, "forecast:view");
      if (scope === "none") return latency<ForecastOverview | null>(null);
      const now = Date.now();
      const current = centerToday(now).slice(0, 7);
      const mine = centers.filter((c) => c.orgId === org && inScope(scope, c.id));
      const histories = mine
        .map((c) => historyOf(c.id, current, now))
        .filter((x): x is CenterHistory => x !== null);
      const ids = mine.map((c) => c.id);
      const money =
        mine.length > 0 && mine.every((c) => allows(viewer, "billing:manage", { centerId: c.id }));

      const months = Array.from({ length: HISTORY_MONTHS }, (_, i) =>
        monthAdd(current, i - HISTORY_MONTHS),
      );
      const summed = (m: ForecastMetric) =>
        months.map((_, i) => sum(histories.map((hc) => hc.series[m][i])));
      const learners = classes
        .filter((c) => ids.includes(c.centerId))
        .reduce((t, c) => t + (rosters[c.id]?.length ?? 0), 0);
      const hoursNow = weeklyHoursAt(ids, now);
      const metrics: ForecastMetric[] = ["leads", "enrolments", "active", "hours"];
      if (money) metrics.push("collected");

      const open = leadsOfOrg(org).filter(
        (l) => ids.includes(l.centerId) && OPEN_STAGES.includes(l.stage),
      );
      const byStage = OPEN_STAGES.map((stage) => ({
        stage,
        leads: open.filter((l) => l.stage === stage).length,
        weight: STAGE_WEIGHT[stage] ?? 0,
      }));

      return latency<ForecastOverview | null>({
        generatedAt: new Date(now).toISOString(),
        fromMonth: current,
        historyFrom: months[0],
        historyTo: months[months.length - 1],
        synthetic: true,
        centers: mine.map((c) => ({
          id: c.id,
          name: c.name,
          hasHistory: histories.some((x) => x.centerId === c.id),
        })),
        metrics:
          histories.length === 0
            ? []
            : metrics.map((m) =>
                forecastSeries(
                  m,
                  months,
                  summed(m),
                  current,
                  m === "active"
                    ? { value: learners, label: `${learners} learners enrolled today` }
                    : m === "hours"
                      ? { value: hoursNow, label: `${hoursNow} h scheduled in the next 7 days` }
                      : null,
                ),
              ),
        money: money ? "shown" : "no_billing_access",
        receivables: money ? openBalancesOf(org, ids, now) : null,
        capacity: scope === "any" ? capacityOf(org) : null,
        pipeline: {
          openLeads: open.length,
          expectedEnrolments: Math.round(sum(byStage.map((s) => s.leads * s.weight)) * 10) / 10,
          byStage,
        },
        maxGrowthPct: MAX_GROWTH_PCT,
        planning:
          histories.length > 0 && wholeOrgWithMoney(viewer, org)
            ? { settings: settingsOf(org), canManage: allows(viewer, "forecast:manage") }
            : null,
      });
    }),
  updateSettings: (viewer, next) =>
    withFault("forecast.updateSettings", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      if (!allows(viewer, "forecast:manage") || !wholeOrgWithMoney(viewer, org))
        return refuse("access_policy");
      const bad = settingsIssue(next);
      if (bad) return refuse("invalid", bad);
      settings.set(org, {
        costs: {
          fixedMonthlyVnd: next.costs.fixedMonthlyVnd,
          variablePct: next.costs.variablePct,
          teacherHourlyVnd: next.costs.teacherHourlyVnd,
        },
        scenarios: Object.fromEntries(
          SCENARIOS.map((k) => [
            k,
            {
              growthAdjPct: next.scenarios[k].growthAdjPct,
              conversionAdjPct: next.scenarios[k].conversionAdjPct,
              tuitionAdjPct: next.scenarios[k].tuitionAdjPct,
            },
          ]),
        ) as ForecastSettings["scenarios"],
      });
      return latency<ForecastResult>({ ok: true });
    }),
};
