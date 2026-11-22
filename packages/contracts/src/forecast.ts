import type { IiosGrantedContext } from "./iiosContext.js";
import type { LeadStage } from "./admissions.js";

/*
 * Business Forecast — ADDITIVE, SYNTHETIC, mock only. Simple, explainable statistics — no AI, no
 * black box. Owner decisions (22/11):
 *  - slice 1 = a base forecast at four horizons (3 / 6 / 9 / 12 months) next to the SAME months
 *    last year (YoY), with every assumption shown read-only. Editable parameters, scenarios, costs
 *    and break-even are slice 2;
 *  - last year comes from a SYNTHETIC two-year monthly history (labelled as such), anchored to
 *    OGC's live data (today's rosters, schedule, pipeline, receivables);
 *  - method: monthly, trend × seasonal index by calendar month (tuition is collected by term:
 *    Term 1–3 and Summer); growth is capped; a ± range from the model's own past error;
 *  - Org Admin + center staff see it (forecast:view, within their policy's centers); the money
 *    figures only for centers where the viewer also holds billing:manage.
 * Slice 2 (owner 22/11): staff with forecast:manage save the cost figures and three FIXED
 * scenarios — conservative / base / optimistic — each tuning growth, conversion and average
 * tuition; anyone who can see the forecast may TRY values on screen without saving. Costs = fixed
 * per month + variable % of revenue + teacher pay per teaching hour (hours from the forecast, as in
 * Workforce). Synthetic default figures per organization, reset with the demo data. Scenarios,
 * cash flow and break-even need the whole organization in view and billing access.
 * The forecast never acts: it informs people, who decide.
 */

export const HORIZONS = [3, 6, 9, 12] as const;
export type Horizon = (typeof HORIZONS)[number];

export type ForecastMetric = "leads" | "enrolments" | "active" | "hours" | "collected";
export type ForecastUnit = "people" | "hours_per_week" | "vnd";

export interface ForecastMonth {
  month: string; // YYYY-MM (center time)
  forecast: number;
  low: number;
  high: number;
  lastYear: number | null; // actual, same calendar month one year earlier
}

export interface MetricForecast {
  metric: ForecastMetric;
  unit: ForecastUnit;
  aggregate: "sum" | "avg"; // flows add up over a horizon; stocks (students, hours / week) average
  months: ForecastMonth[]; // 12 months, starting with the current month
  trailing: { last12: number; prior12: number; yoyPct: number | null }; // actuals (history)
  assumptions: {
    growthPct: number; // yearly trend used (after the cap)
    rawGrowthPct: number; // last 12 months vs the 12 before, before the cap
    capped: boolean;
    seasonal: number[]; // 12 indices, January first; 1.00 = an average month
    errorPct: number; // the model's mean absolute error on the last 12 months → the ± range
    anchor: string | null; // live figure the forecast starts from, in plain words
  };
}

export interface ForecastPipeline {
  openLeads: number;
  expectedEnrolments: number; // Σ leads × stage weight — a cross-check, not added to the forecast
  byStage: { stage: LeadStage; leads: number; weight: number }[];
}

export interface ForecastOverview {
  generatedAt: string;
  fromMonth: string; // first forecast month (the current month)
  historyFrom: string; // first month of the history (YYYY-MM)
  historyTo: string; // last month of the history
  synthetic: true; // the history is synthetic demo data
  centers: { id: string; name: string; hasHistory: boolean }[]; // the viewer's scope
  metrics: MetricForecast[]; // "collected" only when money is shown
  money: "shown" | "no_billing_access";
  receivables: { openVnd: number; overdueVnd: number } | null; // live, with money only
  capacity: {
    hoursPerWeek: number; // Σ teachers' target hours (Workforce)
    teachers: number;
    underPct: number;
    overPct: number;
  } | null; // organization-wide scope only (teachers are not tied to one center)
  pipeline: ForecastPipeline;
  maxGrowthPct: number;
  // Slice 2. null when the viewer does not see the whole organization with money.
  planning: { settings: ForecastSettings; canManage: boolean } | null;
}

export interface HorizonFigure {
  horizon: Horizon;
  forecast: number;
  low: number;
  high: number;
  lastYear: number | null;
  yoyPct: number | null; // (forecast − last year) / last year
}

/** Add up (flows) or average (stocks) the first `horizon` months — shared by UI and tests. */
export function figureFor(m: MetricForecast, horizon: Horizon): HorizonFigure {
  const ms = m.months.slice(0, horizon);
  const agg = (xs: number[]) => {
    const s = xs.reduce((t, x) => t + x, 0);
    return m.aggregate === "sum" ? s : xs.length ? s / xs.length : 0;
  };
  const forecast = agg(ms.map((x) => x.forecast));
  const lastYear = ms.every((x) => x.lastYear !== null)
    ? agg(ms.map((x) => x.lastYear as number))
    : null;
  return {
    horizon,
    forecast,
    low: agg(ms.map((x) => x.low)),
    high: agg(ms.map((x) => x.high)),
    lastYear,
    yoyPct: lastYear && lastYear > 0 ? ((forecast - lastYear) / lastYear) * 100 : null,
  };
}

// ── slice 2: scenarios, costs, cash flow, break-even ───────────────────────────────────────

export const SCENARIOS = ["conservative", "base", "optimistic"] as const;
export type ScenarioKey = (typeof SCENARIOS)[number];

export interface ScenarioParams {
  growthAdjPct: number; // points added to the yearly trend (−50 … +50)
  conversionAdjPct: number; // % change in enrolments (−90 … +200); extra enrolments stay as students
  tuitionAdjPct: number; // % change in average tuition collected (−50 … +100)
}

export interface ForecastCosts {
  fixedMonthlyVnd: number; // rent, salaries other than teaching, utilities …
  variablePct: number; // % of revenue: materials, payment fees, commissions …
  teacherHourlyVnd: number; // teacher pay per teaching hour
}

export interface ForecastSettings {
  costs: ForecastCosts;
  scenarios: Record<ScenarioKey, ScenarioParams>;
}

export interface ScenarioMonth {
  month: string;
  students: number;
  hoursPerWeek: number;
  revenueVnd: number;
  teacherCostVnd: number;
  variableCostVnd: number;
  fixedCostVnd: number;
  netVnd: number;
  cumulativeVnd: number;
}

export interface ScenarioResult {
  key: ScenarioKey;
  params: ScenarioParams;
  months: ScenarioMonth[];
  enrolments12: number;
  leavingPct: number; // learners leaving per month, implied by the base forecast (turnover)
  breakEven: {
    avgStudents: number;
    studentsNeeded: number | null; // null: each student does not cover their own teaching + variable cost
    revenueNeededVnd: number | null; // per month
  };
}

export const SETTINGS_LIMITS = {
  fixedMonthlyVnd: [0, 10_000_000_000],
  variablePct: [0, 90],
  teacherHourlyVnd: [0, 10_000_000],
  growthAdjPct: [-50, 50],
  conversionAdjPct: [-90, 200],
  tuitionAdjPct: [-50, 100],
} as const;

/** Plain-words problem with settings, or null. Shared by the page and the adapter. */
export function settingsIssue(s: ForecastSettings): string | null {
  const within = (k: keyof typeof SETTINGS_LIMITS, x: number) =>
    Number.isFinite(x) && x >= SETTINGS_LIMITS[k][0] && x <= SETTINGS_LIMITS[k][1];
  for (const k of ["fixedMonthlyVnd", "variablePct", "teacherHourlyVnd"] as const)
    if (!within(k, s.costs?.[k])) return `${k} must be ${SETTINGS_LIMITS[k].join("–")}`;
  for (const sc of SCENARIOS)
    for (const k of ["growthAdjPct", "conversionAdjPct", "tuitionAdjPct"] as const)
      if (!within(k, s.scenarios?.[sc]?.[k]))
        return `${sc}: ${k} must be ${SETTINGS_LIMITS[k].join(" to ")}`;
  return null;
}

const WEEKS_PER_MONTH = 52 / 12;

/**
 * One scenario from the base forecast — plain arithmetic, the same on the page and in tests:
 *  trend factor f(k) = ((1 + g + adj) / (1 + g))^(k / 12), month 0 = today (scenarios start equal);
 *  enrolments × (1 + conversion); the extra (or missing) enrolments stay as students for as long
 *  as an average learner does — monthly leaving rate = average enrolments per month ÷ average
 *  students (the base forecast's own turnover);
 *  hours / week follow students; revenue follows students × f × (1 + tuition);
 *  costs = fixed + variable % × revenue + hours / week × 52/12 × teacher pay.
 * Break-even: students needed = fixed ÷ (revenue per student × (1 − variable%) − teaching cost per
 * student), using the scenario's 12-month averages.
 */
export function planScenario(
  base: MetricForecast[],
  costs: ForecastCosts,
  key: ScenarioKey,
  params: ScenarioParams,
): ScenarioResult | null {
  const m = (x: ForecastMetric) => base.find((b) => b.metric === x);
  const enrol = m("enrolments");
  const active = m("active");
  const hours = m("hours");
  const collected = m("collected");
  if (!enrol || !active || !hours || !collected) return null;
  const g = active.assumptions.growthPct / 100;
  const ratio = (1 + g + params.growthAdjPct / 100) / (1 + g);
  const conv = params.conversionAdjPct / 100;
  const meanOf = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / (xs.length || 1);
  const avgActive = meanOf(active.months.map((x) => x.forecast));
  const leaving =
    avgActive > 0 ? Math.min(1, meanOf(enrol.months.map((x) => x.forecast)) / avgActive) : 1;
  let extra = 0;
  let cumulative = 0;
  let enrolments12 = 0;
  const months: ScenarioMonth[] = active.months.map((a, k) => {
    const f = Math.max(0, ratio) ** (k / 12);
    const e = enrol.months[k].forecast * f;
    enrolments12 += e * (1 + conv);
    const baseStudents = a.forecast * f;
    const students = Math.max(0, baseStudents + extra);
    extra = extra * (1 - leaving) + e * conv; // counts from the next month
    const scale = a.forecast > 0 ? students / a.forecast : 0;
    const hoursPerWeek = hours.months[k].forecast * scale;
    const revenueVnd = collected.months[k].forecast * scale * (1 + params.tuitionAdjPct / 100);
    const teacherCostVnd = hoursPerWeek * WEEKS_PER_MONTH * costs.teacherHourlyVnd;
    const variableCostVnd = (revenueVnd * costs.variablePct) / 100;
    const netVnd = revenueVnd - teacherCostVnd - variableCostVnd - costs.fixedMonthlyVnd;
    cumulative += netVnd;
    const r = (x: number) => Math.round(x / 1000) * 1000;
    return {
      month: a.month,
      students: Math.round(students * 10) / 10,
      hoursPerWeek: Math.round(hoursPerWeek * 10) / 10,
      revenueVnd: r(revenueVnd),
      teacherCostVnd: r(teacherCostVnd),
      variableCostVnd: r(variableCostVnd),
      fixedCostVnd: r(costs.fixedMonthlyVnd),
      netVnd: r(netVnd),
      cumulativeVnd: r(cumulative),
    };
  });
  const avg = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / (xs.length || 1);
  const avgStudents = avg(months.map((x) => x.students));
  const perStudentRevenue =
    avgStudents > 0 ? avg(months.map((x) => x.revenueVnd)) / avgStudents : 0;
  const perStudentTeaching =
    avgStudents > 0 ? avg(months.map((x) => x.teacherCostVnd)) / avgStudents : 0;
  const contribution = perStudentRevenue * (1 - costs.variablePct / 100) - perStudentTeaching;
  const studentsNeeded = contribution > 0 ? costs.fixedMonthlyVnd / contribution : null;
  return {
    key,
    params,
    months,
    enrolments12: Math.round(enrolments12 * 10) / 10,
    leavingPct: Math.round(leaving * 1000) / 10,
    breakEven: {
      avgStudents: Math.round(avgStudents * 10) / 10,
      studentsNeeded: studentsNeeded === null ? null : Math.round(studentsNeeded * 10) / 10,
      revenueNeededVnd:
        studentsNeeded === null
          ? null
          : Math.round((studentsNeeded * perStudentRevenue) / 1000) * 1000,
    },
  };
}

export type ForecastRefusal = "not_staff" | "invalid" | "access_policy";
export type ForecastResult = { ok: true } | { ok: false; reason: ForecastRefusal; detail?: string };

export interface ForecastPort {
  // Center staff (incl. Org Admin) with forecast:view; others: null.
  getOverview(viewer: IiosGrantedContext): Promise<ForecastOverview | null>;
  // Slice 2: staff with forecast:manage, whole organization in view with billing access.
  updateSettings(viewer: IiosGrantedContext, next: ForecastSettings): Promise<ForecastResult>;
}
