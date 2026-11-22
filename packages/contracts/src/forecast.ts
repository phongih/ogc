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

export interface ForecastPort {
  // Center staff (incl. Org Admin) with forecast:view; others: null.
  getOverview(viewer: IiosGrantedContext): Promise<ForecastOverview | null>;
}
