// Business Forecast (owner 22/11): 3 / 6 / 9 / 12 months vs the same months last year, plain
// statistics on a SYNTHETIC two-year history anchored to live data. Reads only. SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { figureFor, type ForecastMetric, type ForecastOverview } from "@ogc/contracts";
import { as } from "../../test/grants";
import { MAX_GROWTH_PCT, MIN_ERROR_PCT, forecastSeries, mockForecast as F } from "./mockForecast";
import { __resetAttendanceForTests } from "./mockAttendance";
import { __resetWorkforceForTests } from "./mockWorkforce";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { centers } from "../../fixtures/directory";
import { monthAdd } from "../../fixtures/forecastHistory";

const S = "demo-staff";
const SAM_P = "iios-principal-staff-1";
const metric = (o: ForecastOverview, m: ForecastMetric) => o.metrics.find((x) => x.metric === m)!;

beforeEach(() => {
  __resetAttendanceForTests();
  __resetWorkforceForTests();
});
afterEach(() => __attachForTests(SAM_P, null));

describe("forecast — who sees what", () => {
  it("staff and the Org Admin only; teachers, learners and guardians get nothing", async () => {
    for (const p of ["demo-teacher", "demo-learner", "demo-guardian"])
      expect(await F.getOverview(as(p))).toBeNull();
    expect(await F.getOverview(as("demo-admin"))).not.toBeNull();
    const o = (await F.getOverview(as(S)))!;
    expect(o.synthetic).toBe(true);
    expect(o.money).toBe("shown");
    expect(o.metrics.map((m) => m.metric)).toEqual([
      "leads",
      "enrolments",
      "active",
      "hours",
      "collected",
    ]);
    expect(o.capacity).toMatchObject({ hoursPerWeek: 31, teachers: 4 }); // 2.5 + 4 + 4.5 + 20
  });

  it("Front desk — District 1: D1 figures only, money included (billing at D1), no org capacity", async () => {
    __attachForTests(SAM_P, "policy-front-desk-d1");
    const o = (await F.getOverview(as(S)))!;
    expect(o.centers.map((c) => c.name)).toEqual(["Nova English — District 1"]);
    expect(o.money).toBe("shown");
    expect(o.capacity).toBeNull();
    const all = await (async () => {
      __attachForTests(SAM_P, null);
      return (await F.getOverview(as(S)))!;
    })();
    expect(metric(o, "active").months[0].forecast).toBeLessThan(
      metric(all, "active").months[0].forecast,
    );
  });

  it("forecast without billing access: no money figures, no receivables", async () => {
    const forecastOnly = {
      ...as(S),
      narrowing: {
        state: "policy" as const,
        policyRef: "test",
        version: 1,
        name: "Forecast only",
        rules: [{ action: "forecast:view" as const }],
      },
    };
    const o = (await F.getOverview(forecastOnly))!;
    expect(o.money).toBe("no_billing_access");
    expect(o.receivables).toBeNull();
    expect(o.metrics.map((m) => m.metric)).not.toContain("collected");
  });

  it("a policy without a forecast rule leaves the forecast closed (fail-closed)", async () => {
    __attachForTests(SAM_P, "policy-own-classes");
    expect(await F.getOverview(as(S))).toBeNull();
  });

  it("a center with no learners has no history; the org total still forecasts", async () => {
    const o = (await F.getOverview(as(S)))!;
    const cg = o.centers.find((c) => c.id === centers[2].id)!;
    expect(cg.hasHistory).toBe(false);
    expect(o.centers.filter((c) => c.hasHistory)).toHaveLength(2);
  });
});

describe("forecast — the model", () => {
  it("12 months from the current month, each next to the same month last year", async () => {
    const o = (await F.getOverview(as(S)))!;
    const a = metric(o, "active");
    expect(a.months).toHaveLength(12);
    expect(a.months[0].month).toBe(o.fromMonth);
    expect(a.months[11].month).toBe(monthAdd(o.fromMonth, 11));
    expect(o.historyTo).toBe(monthAdd(o.fromMonth, -1));
    expect(o.historyFrom).toBe(monthAdd(o.fromMonth, -24));
    for (const m of o.metrics)
      for (const x of m.months) {
        expect(x.lastYear).not.toBeNull();
        expect(x.low).toBeLessThanOrEqual(x.forecast);
        expect(x.high).toBeGreaterThanOrEqual(x.forecast);
      }
  });

  it("students and hours start from today's live figures (anchor)", async () => {
    const o = (await F.getOverview(as(S)))!;
    expect(metric(o, "active").months[0].forecast).toBe(7); // 7 learners on the rosters
    expect(metric(o, "active").assumptions.anchor).toMatch(/7 learners enrolled today/);
    expect(metric(o, "hours").months[0].forecast).toBe(6); // Tara 3 h + Ben 3 h this week
    expect(metric(o, "leads").assumptions.anchor).toBeNull();
  });

  it("seasonal indices average 1.00; tuition peaks in the term due months", async () => {
    const o = (await F.getOverview(as(S)))!;
    for (const m of o.metrics) {
      const s = m.assumptions.seasonal;
      expect(s.reduce((t, x) => t + x, 0) / 12).toBeCloseTo(1, 1);
    }
    const c = metric(o, "collected").assumptions.seasonal;
    for (const due of [2, 5, 8, 11]) expect(c[due]).toBeGreaterThan(2); // Mar, Jun, Sep, Dec
  });

  it("growth comes from the last 12 vs the 12 before, and is capped", () => {
    const months = Array.from({ length: 24 }, (_, i) => monthAdd("2024-11", i));
    const flat = forecastSeries("leads", months, Array(24).fill(10), "2026-11", null);
    expect(flat.assumptions).toMatchObject({ growthPct: 0, capped: false });
    expect(flat.months.every((m) => m.forecast === 10)).toBe(true);
    expect(flat.assumptions.errorPct).toBe(MIN_ERROR_PCT);
    const doubled = forecastSeries(
      "leads",
      months,
      [...Array(12).fill(10), ...Array(12).fill(20)],
      "2026-11",
      null,
    );
    expect(doubled.assumptions).toMatchObject({
      rawGrowthPct: 100,
      growthPct: MAX_GROWTH_PCT,
      capped: true,
    });
    expect(doubled.trailing).toMatchObject({ last12: 240, prior12: 120, yoyPct: 100 });
  });

  it("horizons add up flows and average stocks; YoY against the same months last year", () => {
    const months = Array.from({ length: 24 }, (_, i) => monthAdd("2024-11", i));
    const f = forecastSeries("leads", months, Array(24).fill(10), "2026-11", null);
    expect(figureFor(f, 3)).toMatchObject({ forecast: 30, lastYear: 30, yoyPct: 0 });
    expect(figureFor(f, 12)).toMatchObject({ forecast: 120, lastYear: 120 });
    const s = forecastSeries("active", months, Array(24).fill(8), "2026-11", null);
    expect(figureFor(s, 6).forecast).toBe(8);
  });

  it("the pipeline cross-check weights open leads by stage and is not added to the forecast", async () => {
    const o = (await F.getOverview(as(S)))!;
    const p = o.pipeline;
    expect(p.openLeads).toBe(p.byStage.reduce((t, s) => t + s.leads, 0));
    expect(p.expectedEnrolments).toBeCloseTo(
      p.byStage.reduce((t, s) => t + s.leads * s.weight, 0),
      1,
    );
    expect(p.expectedEnrolments).toBeLessThan(p.openLeads);
  });
});
