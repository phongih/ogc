/*
 * Workforce · Teacher Load (owner decisions 22/11). Teaching hours in the next 7 days from OGC's
 * own schedule, against each teacher's target; bands as % of target (staff tune). SYNTHETIC.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Employment,
  LoadBand,
  TeacherLoad,
  WorkforceResult,
  WorkforceSettings,
} from "@ogc/contracts";
import { workforce } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import { pctText } from "./LoadHint";

const BAND_LABEL: Record<LoadBand, string> = {
  under: "Has room",
  meet: "On target",
  over: "Over target",
};
const BAND_STYLE: Record<LoadBand, string> = {
  under: "border-border text-muted",
  meet: "border-brand text-brand",
  over: "border-danger text-danger",
};
const KIND_LABEL = {
  class: "class teacher",
  substitute: "substitute",
  makeup: "make-up",
  prep: "Learning Studio prep",
} as const;
const REFUSAL: Record<string, string> = {
  not_staff: "Only center staff can do this.",
  not_found: "Not found.",
  invalid: "Not valid",
  access_policy: "Your access policy does not allow this.",
};

function useAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<WorkforceResult>) => run(),
    onSuccess: () => refreshLearningState(qc),
  });
}
function Refused({ r }: { r: WorkforceResult | undefined }) {
  if (!r || r.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[r.reason] ?? r.reason}
      {r.detail ? `: ${r.detail}` : ""}
    </p>
  );
}

export function WorkforcePage() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["workforce", viewer],
    queryFn: () => workforce.getOverview(viewer),
  });
  if (q.isLoading) return <Spinner label="Loading workforce" />;
  if (q.isError)
    return <ErrorState message="Could not load workforce." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Workforce is for center staff" />;
  const o = q.data;
  return (
    <section className="space-y-4">
      <PageHeader title="Workforce" subtitle="Teacher load · synthetic demo" />
      <p className="text-xs text-muted">
        Teaching hours from {formatCenterDate(o.windowFrom)} to {formatCenterDate(o.windowTo)} (next
        7 days), from the live schedule: each session&apos;s real length; a substitute&apos;s
        session counts for the substitute. Suggestions elsewhere never assign anyone; going over
        target only warns.
      </p>
      <AccessBanner />
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Utilization"
          value={<span data-testid="utilization">{pctText(o.utilizationPct)}</span>}
          hint={`${o.totalHours} of ${o.totalTargetHours} target hours`}
        />
        <StatTile
          label="Over target"
          value={<span data-testid="band-over">{o.bands.over}</span>}
          hint={`above ${o.settings.overPct}%`}
        />
        <StatTile
          label="On target"
          value={<span data-testid="band-meet">{o.bands.meet}</span>}
          hint={`${o.settings.underPct}–${o.settings.overPct}%`}
        />
        <StatTile
          label="Has room"
          value={<span data-testid="band-under">{o.bands.under}</span>}
          hint={`below ${o.settings.underPct}%`}
        />
      </div>
      <ul className="space-y-2" aria-label="Teacher load">
        {o.teachers.map((t) => (
          <li key={t.teacherId}>
            <TeacherRow t={t} />
          </li>
        ))}
      </ul>
      <Thresholds key={JSON.stringify(o.settings)} settings={o.settings} />
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Center operations
      </Link>
    </section>
  );
}

function TeacherRow({ t }: { t: TeacherLoad }) {
  const viewer = useViewer();
  const act = useAction();
  const me = useMyAccess();
  const can = me.data?.allowed["workforce:manage"] ?? true;
  const [open, setOpen] = useState(false);
  const [emp, setEmp] = useState<Employment>(t.employment);
  const [hours, setHours] = useState(String(t.targetHours));
  const width = Math.min(100, t.pct ?? 0);
  return (
    <Card className="space-y-2">
      <section aria-label={`Load of ${t.name}`} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p>
            <span className="font-medium">{t.name}</span>{" "}
            <span className="text-sm text-muted">
              · {t.employment === "full_time" ? "full-time" : "part-time"} · {t.classes} class
              {t.classes === 1 ? "" : "es"}
            </span>
          </p>
          <span className="flex items-center gap-3 text-sm">
            <span data-testid={`load-${t.name}`}>
              {t.hours} of {t.targetHours} h · {pctText(t.pct)}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${BAND_STYLE[t.band]}`}>
              {BAND_LABEL[t.band]}
            </span>
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-border" aria-hidden="true">
          <div
            className={`h-2 rounded-full ${t.band === "over" ? "bg-danger" : "bg-brand"}`}
            style={{ width: `${width}%` }}
          />
        </div>
        <button
          type="button"
          className="text-sm text-brand underline"
          aria-expanded={open}
          onClick={() => setOpen((x) => !x)}
        >
          {open ? "Hide" : "Details"} · {t.name}
        </button>
        {open ? (
          <div className="space-y-2 border-t border-border pt-2 text-sm">
            {t.breakdown.length ? (
              <ul aria-label={`Sessions of ${t.name}`}>
                {t.breakdown.map((b, i) => (
                  <li key={i}>
                    {b.label} · {KIND_LABEL[b.kind]} ·{" "}
                    {b.kind === "prep"
                      ? `${b.hours} h / week`
                      : `${b.sessions} session${b.sessions === 1 ? "" : "s"} · ${b.hours} h`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">No sessions in the next 7 days.</p>
            )}
            <div className="flex flex-wrap items-end gap-2">
              <select
                aria-label={`Employment of ${t.name}`}
                disabled={!can}
                className="rounded-ogc border border-border bg-surface p-1"
                value={emp}
                onChange={(e) => setEmp(e.target.value as Employment)}
              >
                <option value="full_time">Full-time</option>
                <option value="part_time">Part-time</option>
              </select>
              <label>
                <span className="block text-xs text-muted">Target hours / week</span>
                <input
                  aria-label={`Target hours of ${t.name}`}
                  type="number"
                  step="0.5"
                  disabled={!can}
                  className="w-24 rounded-ogc border border-border bg-surface p-1"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
              </label>
              <Button
                variant="ghost"
                disabled={!can}
                onClick={() =>
                  act.mutate(() => workforce.setTarget(viewer, t.teacherId, emp, Number(hours)))
                }
              >
                Save target · {t.name}
              </Button>
            </div>
            <Refused r={act.data} />
          </div>
        ) : null}
      </section>
    </Card>
  );
}

function Thresholds({ settings }: { settings: WorkforceSettings }) {
  const viewer = useViewer();
  const act = useAction();
  const me = useMyAccess();
  const can = me.data?.allowed["workforce:manage"] ?? true;
  const [s, setS] = useState(settings);
  const num = "w-20 rounded-ogc border border-border bg-surface p-1";
  return (
    <Card className="space-y-2">
      <h2 className="font-medium">Thresholds (% of each teacher&apos;s target)</h2>
      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label>
          <span className="block">Has room below</span>
          <input
            aria-label="Has room below"
            type="number"
            disabled={!can}
            className={num}
            value={s.underPct}
            onChange={(e) => setS({ ...s, underPct: Number(e.target.value) })}
          />
        </label>
        <label>
          <span className="block">Over target above</span>
          <input
            aria-label="Over target above"
            type="number"
            disabled={!can}
            className={num}
            value={s.overPct}
            onChange={(e) => setS({ ...s, overPct: Number(e.target.value) })}
          />
        </label>
        <Button
          disabled={!can}
          onClick={() => act.mutate(() => workforce.updateSettings(viewer, s))}
        >
          Save thresholds
        </Button>
      </div>
      <Refused r={act.data} />
    </Card>
  );
}
