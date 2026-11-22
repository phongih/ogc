/*
 * Business Forecast (owner decisions 22/11). Four horizons — 3 / 6 / 9 / 12 months — next to the
 * same months last year, from plain statistics (trend × seasonal index) on a SYNTHETIC two-year
 * history anchored to live data. Every assumption is shown; nothing here acts. Editable
 * parameters, scenarios, costs and break-even come in slice 2.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  HORIZONS,
  figureFor,
  type ForecastMetric,
  type ForecastOverview,
  type Horizon,
  type MetricForecast,
} from "@ogc/contracts";
import { forecast } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { STAGE_LABEL } from "../admissions/AdmissionsPage";
import { vnd } from "../growth/format";

const LABEL: Record<ForecastMetric, string> = {
  leads: "New leads",
  enrolments: "New enrolments",
  active: "Students (average)",
  hours: "Teaching hours / week (average)",
  collected: "Tuition collected",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** People flows add up to whole numbers over a horizon; one month keeps a decimal. */
function fmt(m: MetricForecast, x: number, month = false): string {
  if (m.unit === "vnd") return `${(x / 1_000_000).toFixed(1)} M ₫`;
  if (m.unit === "hours_per_week") return `${x.toFixed(1)} h`;
  return m.aggregate === "sum" && !month ? `${Math.round(x)}` : x.toFixed(1);
}
const pct = (x: number | null) =>
  x === null ? "—" : `${x > 0 ? "▲ +" : x < 0 ? "▼ " : ""}${x.toFixed(1)}%`;

export function ForecastPage() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["forecast", viewer],
    queryFn: () => forecast.getOverview(viewer),
  });
  const [horizon, setHorizon] = useState<Horizon>(3);
  const [metric, setMetric] = useState<ForecastMetric>("enrolments");
  if (q.isLoading) return <Spinner label="Loading forecast" />;
  if (q.isError)
    return <ErrorState message="Could not load the forecast." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="The forecast is for center staff" />;
  const o = q.data;
  const selected = o.metrics.find((m) => m.metric === metric) ?? o.metrics[0];
  return (
    <section className="space-y-4">
      <PageHeader
        title="Business forecast"
        subtitle="3 / 6 / 9 / 12 months vs the same months last year · synthetic demo"
      />
      <p className="text-xs text-muted">
        Simple statistics, no AI: each figure is the last 12 months&apos; level × a yearly trend × a
        seasonal index by month, with a ± range from the model&apos;s own past error. History{" "}
        {monthLabel(o.historyFrom)} – {monthLabel(o.historyTo)} is{" "}
        <strong>synthetic demo data</strong>, sized to this center; students and teaching hours
        start from today&apos;s live figures. The forecast never acts — people decide.
      </p>
      <AccessBanner />
      <p className="text-sm" data-testid="forecast-scope">
        Centers: {o.centers.map((c) => c.name).join(", ") || "none"}
        {o.centers.some((c) => !c.hasHistory)
          ? ` · no history yet: ${o.centers
              .filter((c) => !c.hasHistory)
              .map((c) => c.name)
              .join(", ")}`
          : ""}
      </p>
      {o.metrics.length === 0 ? (
        <EmptyState
          title="Not enough history to forecast"
          hint="None of the centers in your view has history yet."
        />
      ) : (
        <>
          <Summary o={o} />
          <Detail
            o={o}
            m={selected}
            horizon={horizon}
            onHorizon={setHorizon}
            onMetric={setMetric}
          />
          <Capacity o={o} horizon={horizon} />
          <Pipeline o={o} />
          <Money o={o} />
          <Assumptions o={o} />
        </>
      )}
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Center operations
      </Link>
    </section>
  );
}

function Summary({ o }: { o: ForecastOverview }) {
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Four horizons vs last year</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" aria-label="Forecast by horizon">
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 pr-3 font-normal">
                Metric
              </th>
              {HORIZONS.map((h) => (
                <th key={h} scope="col" className="py-1 pr-3 font-normal">
                  {h === 12 ? "12 months" : `${h} months`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.metrics.map((m) => (
              <tr key={m.metric} className="border-t border-border align-top">
                <th scope="row" className="py-2 pr-3 text-left font-medium">
                  {LABEL[m.metric]}
                </th>
                {HORIZONS.map((h) => {
                  const f = figureFor(m, h);
                  return (
                    <td key={h} className="py-2 pr-3" data-testid={`cell-${m.metric}-${h}`}>
                      <div className="font-semibold">{fmt(m, f.forecast)}</div>
                      <div className="text-xs text-muted">
                        {fmt(m, f.low)} – {fmt(m, f.high)}
                      </div>
                      <div className="text-xs">
                        {pct(f.yoyPct)}{" "}
                        <span className="text-muted">
                          vs {f.lastYear === null ? "—" : fmt(m, f.lastYear)} last year
                        </span>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Horizons start with this month ({monthLabel(o.fromMonth)}). Leads, enrolments and tuition
        add up over the horizon; students and hours / week are averages.
      </p>
    </Card>
  );
}

function Detail({
  o,
  m,
  horizon,
  onHorizon,
  onMetric,
}: {
  o: ForecastOverview;
  m: MetricForecast;
  horizon: Horizon;
  onHorizon: (h: Horizon) => void;
  onMetric: (m: ForecastMetric) => void;
}) {
  const rows = m.months.slice(0, horizon);
  const top = Math.max(...rows.flatMap((r) => [r.high, r.lastYear ?? 0]), 1);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-semibold">Month by month</h2>
        <label className="text-sm">
          <span className="sr-only">Metric</span>
          <select
            className="rounded-ogc border border-border bg-surface px-2 py-1"
            value={m.metric}
            onChange={(e) => onMetric(e.target.value as ForecastMetric)}
            aria-label="Metric"
          >
            {o.metrics.map((x) => (
              <option key={x.metric} value={x.metric}>
                {LABEL[x.metric]}
              </option>
            ))}
          </select>
        </label>
        <div role="group" aria-label="Horizon" className="flex gap-1">
          {HORIZONS.map((h) => (
            <button
              key={h}
              type="button"
              aria-pressed={h === horizon}
              onClick={() => onHorizon(h)}
              className={`rounded-ogc border px-3 py-1 text-sm ${
                h === horizon ? "border-brand text-brand" : "border-border"
              }`}
            >
              {h} mo
            </button>
          ))}
        </div>
      </div>
      <table className="w-full text-sm" aria-label={`${LABEL[m.metric]} by month`}>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="py-1 pr-3 font-normal">
              Month
            </th>
            <th scope="col" className="py-1 pr-3 font-normal">
              Forecast (range)
            </th>
            <th scope="col" className="py-1 pr-3 font-normal">
              Same month last year
            </th>
            <th scope="col" className="py-1 pr-3 font-normal">
              Change
            </th>
            <th scope="col" className="w-1/3 py-1 font-normal">
              <span className="sr-only">Bars</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.month} className="border-t border-border">
              <td className="py-1 pr-3">{monthLabel(r.month)}</td>
              <td className="py-1 pr-3">
                <span className="font-medium">{fmt(m, r.forecast, true)}</span>{" "}
                <span className="text-xs text-muted">
                  ({fmt(m, r.low, true)} – {fmt(m, r.high, true)})
                </span>
              </td>
              <td className="py-1 pr-3">{r.lastYear === null ? "—" : fmt(m, r.lastYear, true)}</td>
              <td className="py-1 pr-3 text-xs">
                {pct(r.lastYear ? ((r.forecast - r.lastYear) / r.lastYear) * 100 : null)}
              </td>
              <td className="py-1" aria-hidden="true">
                <div
                  className="h-2 rounded bg-brand"
                  style={{ width: `${(r.forecast / top) * 100}%` }}
                />
                <div
                  className="mt-0.5 h-2 rounded bg-border"
                  style={{ width: `${((r.lastYear ?? 0) / top) * 100}%` }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">Bars: forecast (top) and the same month last year.</p>
    </Card>
  );
}

function Capacity({ o, horizon }: { o: ForecastOverview; horizon: Horizon }) {
  const h = o.metrics.find((m) => m.metric === "hours");
  if (!h) return null;
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Teaching load vs capacity</h2>
      {o.capacity ? (
        <CapacityBody h={h} horizon={horizon} cap={o.capacity} />
      ) : (
        <p className="text-sm text-muted">
          Capacity is organization-wide (teachers are not tied to one center); your access covers
          some centers only. Forecast hours / week are in the table above.
        </p>
      )}
    </Card>
  );
}

function CapacityBody({
  h,
  horizon,
  cap,
}: {
  h: MetricForecast;
  horizon: Horizon;
  cap: NonNullable<ForecastOverview["capacity"]>;
}) {
  const rows = h.months.slice(0, horizon);
  const util = (x: number) => (cap.hoursPerWeek > 0 ? (x / cap.hoursPerWeek) * 100 : null);
  const peak = rows.reduce((a, b) => (b.high > a.high ? b : a), rows[0]);
  const avg = figureFor(h, horizon).forecast;
  const band = (p: number | null) =>
    p === null
      ? "no target set"
      : p > cap.overPct
        ? "over capacity — a bottleneck for opening classes"
        : p < cap.underPct
          ? "has room to open classes"
          : "on target";
  return (
    <div className="space-y-1 text-sm" data-testid="capacity">
      <p>
        Capacity: <strong>{cap.hoursPerWeek} h / week</strong> — the target hours of {cap.teachers}{" "}
        teachers (Workforce). Thresholds: under {cap.underPct}%, over {cap.overPct}%.
      </p>
      <p>
        Next {horizon} months: average {avg.toFixed(1)} h / week = {util(avg)?.toFixed(0) ?? "—"}% —{" "}
        {band(util(avg))}.
      </p>
      <p>
        Busiest month: {monthLabel(peak.month)}, up to {peak.high.toFixed(1)} h / week (
        {util(peak.high)?.toFixed(0) ?? "—"}%) — {band(util(peak.high))}.
      </p>
      <p className="text-xs text-muted">
        Suggest only: Workforce shows who has room when a class or substitute is chosen.
      </p>
    </div>
  );
}

function Pipeline({ o }: { o: ForecastOverview }) {
  const p = o.pipeline;
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Cross-check: today&apos;s admissions pipeline</h2>
      <p className="text-sm" data-testid="pipeline">
        {p.openLeads} open leads → about <strong>{p.expectedEnrolments}</strong> enrolments if each
        stage converts at its default weight. Compare with the next 3 months&apos; enrolment
        forecast; this is not added to it.
      </p>
      <ul className="mt-2 flex flex-wrap gap-2 text-xs">
        {p.byStage.map((s) => (
          <li key={s.stage} className="rounded-ogc border border-border px-2 py-1">
            {STAGE_LABEL[s.stage]}: {s.leads} × {s.weight}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Money({ o }: { o: ForecastOverview }) {
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Cash</h2>
      {o.money === "shown" && o.receivables ? (
        <p className="text-sm" data-testid="receivables">
          Open invoices today: {vnd(o.receivables.openVnd)}, of which overdue{" "}
          {vnd(o.receivables.overdueVnd)} (Billing, live). Tuition is collected mostly in each
          term&apos;s due month (Sep, Dec, Mar, Jun). Costs and break-even come with scenarios (next
          slice).
        </p>
      ) : (
        <p className="text-sm text-muted" data-testid="no-money">
          Money figures need billing access at every center in your view.
        </p>
      )}
    </Card>
  );
}

function Assumptions({ o }: { o: ForecastOverview }) {
  return (
    <Card>
      <h2 className="mb-2 font-semibold">Assumptions (read-only)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" aria-label="Assumptions">
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 pr-3 font-normal">
                Metric
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                Last 12 vs prior 12
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                Trend used / year
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                ± range
              </th>
              <th scope="col" className="py-1 pr-3 font-normal">
                Starts from
              </th>
              {MONTHS.map((mo) => (
                <th key={mo} scope="col" className="py-1 pr-1 font-normal">
                  {mo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {o.metrics.map((m) => (
              <tr key={m.metric} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 text-left font-medium">
                  {LABEL[m.metric]}
                </th>
                <td className="py-1 pr-3">
                  {fmt(m, m.trailing.last12)} vs {fmt(m, m.trailing.prior12)} (
                  {pct(m.trailing.yoyPct)})
                </td>
                <td className="py-1 pr-3">
                  {m.assumptions.growthPct > 0 ? "+" : ""}
                  {m.assumptions.growthPct}%
                  {m.assumptions.capped ? ` (capped from ${m.assumptions.rawGrowthPct}%)` : ""}
                </td>
                <td className="py-1 pr-3">±{m.assumptions.errorPct}%</td>
                <td className="py-1 pr-3">{m.assumptions.anchor ?? "history"}</td>
                {m.assumptions.seasonal.map((s, i) => (
                  <td key={i} className="py-1 pr-1">
                    {s.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Seasonal index: 1.00 is an average month. The yearly trend is capped at ±{o.maxGrowthPct}%.
        Editing these and comparing scenarios comes in the next slice.
      </p>
    </Card>
  );
}
