/*
 * Business Forecast slice 2 (owner 22/11): three fixed scenarios side by side, costs, cash flow and
 * break-even. Anyone who sees the forecast may TRY values here (nothing is saved); staff with
 * forecast:manage save them for the organization. Plain arithmetic from @ogc/contracts
 * (planScenario) — the same numbers the tests check. Synthetic default figures.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  SCENARIOS,
  planScenario,
  settingsIssue,
  type ForecastOverview,
  type ForecastResult,
  type ForecastSettings,
  type ScenarioKey,
  type ScenarioParams,
  type ScenarioResult,
} from "@ogc/contracts";
import { forecast } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { Button, Card } from "../../ui";
import { vnd } from "../growth/format";

const SCENARIO_LABEL: Record<ScenarioKey, string> = {
  conservative: "Conservative",
  base: "Base",
  optimistic: "Optimistic",
};
const PARAM_LABEL: Record<keyof ScenarioParams, string> = {
  growthAdjPct: "Growth (± points / year)",
  conversionAdjPct: "Enrolments (± %)",
  tuitionAdjPct: "Average tuition (± %)",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const m = (x: number) => `${(x / 1_000_000).toFixed(1)} M ₫`;
const REFUSAL: Record<string, string> = {
  not_staff: "Only center staff can do this.",
  invalid: "Not valid",
  access_policy: "Your access policy does not allow saving the forecast figures.",
};

export function Scenarios({ o }: { o: ForecastOverview }) {
  if (!o.planning)
    return (
      <Card>
        <h2 className="mb-2 font-semibold">Scenarios &amp; break-even</h2>
        <p className="text-sm text-muted" data-testid="no-scenarios">
          Scenarios, cash flow and break-even use organization-wide costs, so they need the whole
          organization in your view and billing access.
        </p>
      </Card>
    );
  return <Planner o={o} saved={o.planning.settings} canManage={o.planning.canManage} />;
}

function Planner({
  o,
  saved,
  canManage,
}: {
  o: ForecastOverview;
  saved: ForecastSettings;
  canManage: boolean;
}) {
  const viewer = useViewer();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<ForecastSettings>(saved);
  const [selected, setSelected] = useState<ScenarioKey>("base");
  const save = useMutation({
    mutationFn: (next: ForecastSettings): Promise<ForecastResult> =>
      forecast.updateSettings(viewer, next),
    onSuccess: () => refreshLearningState(qc),
  });
  const issue = settingsIssue(draft);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const results = issue
    ? []
    : SCENARIOS.map((k) => planScenario(o.metrics, draft.costs, k, draft.scenarios[k])).filter(
        (r): r is ScenarioResult => r !== null,
      );
  const chosen = results.find((r) => r.key === selected);
  const setCost = (k: keyof ForecastSettings["costs"], v: number) =>
    setDraft((d) => ({ ...d, costs: { ...d.costs, [k]: v } }));
  const setParam = (sc: ScenarioKey, k: keyof ScenarioParams, v: number) =>
    setDraft((d) => ({
      ...d,
      scenarios: { ...d.scenarios, [sc]: { ...d.scenarios[sc], [k]: v } },
    }));
  const num = (v: string) => (v.trim() === "" ? Number.NaN : Number(v));

  return (
    <>
      <Card>
        <h2 className="mb-1 font-semibold">Scenarios &amp; break-even · next 12 months</h2>
        <p className="mb-3 text-xs text-muted">
          Each scenario starts from today and changes the yearly trend, the number of enrolments
          (extra learners stay as long as an average learner — {results[0]?.leavingPct ?? "—"}%
          leave per month in the base forecast) and the average tuition. Costs: fixed per month +
          variable % of revenue + teacher pay per teaching hour (hours follow students). Default
          figures are <strong>synthetic</strong>.
        </p>
        {results.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" aria-label="Scenarios compared">
              <thead>
                <tr className="text-left text-muted">
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Scenario
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Revenue
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Costs
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Net cash (3 / 6 / 9 / 12 mo)
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Enrolments
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Break-even
                  </th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const rev = r.months.reduce((t, x) => t + x.revenueVnd, 0);
                  const cost = r.months.reduce(
                    (t, x) => t + x.fixedCostVnd + x.variableCostVnd + x.teacherCostVnd,
                    0,
                  );
                  const be = r.breakEven;
                  return (
                    <tr
                      key={r.key}
                      className="border-t border-border align-top"
                      data-testid={`scenario-${r.key}`}
                    >
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        {SCENARIO_LABEL[r.key]}
                      </th>
                      <td className="py-2 pr-3">{m(rev)}</td>
                      <td className="py-2 pr-3">{m(cost)}</td>
                      <td className="py-2 pr-3">
                        {[2, 5, 8, 11].map((i) => (
                          <span
                            key={i}
                            className={`mr-2 ${r.months[i].cumulativeVnd < 0 ? "text-danger" : ""}`}
                          >
                            {m(r.months[i].cumulativeVnd)}
                          </span>
                        ))}
                      </td>
                      <td className="py-2 pr-3">{r.enrolments12.toFixed(1)}</td>
                      <td className="py-2 pr-3">
                        {be.studentsNeeded === null ? (
                          <span className="text-danger">
                            not reachable — each learner costs more than they bring
                          </span>
                        ) : (
                          <>
                            {be.studentsNeeded.toFixed(1)} students · {m(be.revenueNeededVnd ?? 0)}{" "}
                            / month
                            <div className="text-xs text-muted">
                              forecast average {be.avgStudents.toFixed(1)} —{" "}
                              {be.avgStudents >= be.studentsNeeded ? "above" : "below"} break-even
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p role="alert" className="text-sm text-danger">
            Not valid: {issue}
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Figures</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Fixed costs / month (₫)"
            value={draft.costs.fixedMonthlyVnd}
            onChange={(v) => setCost("fixedMonthlyVnd", num(v))}
            hint="rent, staff other than teaching, utilities"
          />
          <NumberField
            label="Variable costs (% of revenue)"
            value={draft.costs.variablePct}
            onChange={(v) => setCost("variablePct", num(v))}
            hint="materials, payment fees, commissions"
          />
          <NumberField
            label="Teacher pay / teaching hour (₫)"
            value={draft.costs.teacherHourlyVnd}
            onChange={(v) => setCost("teacherHourlyVnd", num(v))}
            hint="hours from the forecast, as in Workforce"
          />
        </div>
        <table className="mt-4 w-full text-sm" aria-label="Scenario settings">
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 pr-3 font-normal">
                Scenario
              </th>
              {(Object.keys(PARAM_LABEL) as (keyof ScenarioParams)[]).map((k) => (
                <th key={k} scope="col" className="py-1 pr-3 font-normal">
                  {PARAM_LABEL[k]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SCENARIOS.map((sc) => (
              <tr key={sc} className="border-t border-border">
                <th scope="row" className="py-1 pr-3 text-left font-medium">
                  {SCENARIO_LABEL[sc]}
                </th>
                {(Object.keys(PARAM_LABEL) as (keyof ScenarioParams)[]).map((k) => (
                  <td key={k} className="py-1 pr-3">
                    <input
                      type="number"
                      aria-label={`${SCENARIO_LABEL[sc]} · ${PARAM_LABEL[k]}`}
                      className="w-24 rounded-ogc border border-border bg-surface px-2 py-1"
                      value={Number.isNaN(draft.scenarios[sc][k]) ? "" : draft.scenarios[sc][k]}
                      onChange={(e) => setParam(sc, k, num(e.target.value))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canManage ? (
            <Button
              disabled={!changed || !!issue || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              Save figures
            </Button>
          ) : (
            <p className="text-xs text-muted" data-testid="try-only">
              Trying only — saving needs the forecast:manage permission.
            </p>
          )}
          {changed ? (
            <button type="button" className="text-sm text-brand" onClick={() => setDraft(saved)}>
              Back to saved figures
            </button>
          ) : null}
          {save.data && !save.data.ok ? (
            <p role="alert" className="text-sm text-danger">
              {REFUSAL[save.data.reason] ?? save.data.reason}
              {save.data.detail ? `: ${save.data.detail}` : ""}
            </p>
          ) : null}
          {save.data?.ok && !changed ? (
            <p className="text-sm text-muted" role="status">
              Saved.
            </p>
          ) : null}
        </div>
      </Card>

      {chosen ? (
        <Card>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto font-semibold">Cash flow by month</h2>
            <div role="group" aria-label="Scenario" className="flex gap-1">
              {SCENARIOS.map((sc) => (
                <button
                  key={sc}
                  type="button"
                  aria-pressed={sc === selected}
                  onClick={() => setSelected(sc)}
                  className={`rounded-ogc border px-3 py-1 text-sm ${
                    sc === selected ? "border-brand text-brand" : "border-border"
                  }`}
                >
                  {SCENARIO_LABEL[sc]}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table
              className="w-full text-sm"
              aria-label={`Cash flow · ${SCENARIO_LABEL[selected]}`}
            >
              <thead>
                <tr className="text-left text-muted">
                  {[
                    "Month",
                    "Students",
                    "Hours / week",
                    "Revenue",
                    "Teacher pay",
                    "Variable",
                    "Fixed",
                    "Net",
                    "Cumulative",
                  ].map((h) => (
                    <th key={h} scope="col" className="py-1 pr-3 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chosen.months.map((x) => (
                  <tr key={x.month} className="border-t border-border">
                    <td className="py-1 pr-3">{monthLabel(x.month)}</td>
                    <td className="py-1 pr-3">{x.students.toFixed(1)}</td>
                    <td className="py-1 pr-3">{x.hoursPerWeek.toFixed(1)}</td>
                    <td className="py-1 pr-3">{vnd(x.revenueVnd)}</td>
                    <td className="py-1 pr-3">{vnd(x.teacherCostVnd)}</td>
                    <td className="py-1 pr-3">{vnd(x.variableCostVnd)}</td>
                    <td className="py-1 pr-3">{vnd(x.fixedCostVnd)}</td>
                    <td className={`py-1 pr-3 ${x.netVnd < 0 ? "text-danger" : ""}`}>
                      {vnd(x.netVnd)}
                    </td>
                    <td className={`py-1 pr-3 ${x.cumulativeVnd < 0 ? "text-danger" : ""}`}>
                      {vnd(x.cumulativeVnd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">
            Tuition comes in mostly in each term&apos;s due month (Sep, Dec, Mar, Jun), so months in
            between are often negative; look at the cumulative column.
          </p>
        </Card>
      ) : null}
    </>
  );
}

function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
  hint: string;
}) {
  return (
    <label className="text-sm">
      <span className="block text-muted">{label}</span>
      <input
        type="number"
        className="mt-1 w-full rounded-ogc border border-border bg-surface px-2 py-1"
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="mt-0.5 block text-xs text-muted">{hint}</span>
    </label>
  );
}
