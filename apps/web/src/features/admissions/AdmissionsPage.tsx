/*
 * Admissions Intelligence for center staff (owner decisions 22/11; pattern from EduOS Admissions).
 * One pipeline for every lead (referrals included), an explainable score, a funnel / counselor
 * dashboard whose rates always show numerator and denominator. SYNTHETIC — minimal profile, no
 * contact details. The adapter decides every action; this page only reflects it.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AdmissionsResult,
  BillingResult,
  ContactChannel,
  Lead,
  LeadActivityKind,
  LeadDraft,
  LeadStage,
  LearningNeed,
  Ratio,
  ScoreKey,
  ScoringSettings,
} from "@ogc/contracts";
import { FUNNEL, LEARNING_NEEDS, MANUAL_STAGES, SCORE_KEYS } from "@ogc/contracts";
import { admissions, billing } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDate, formatCenterDateTime } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";
import { centers } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { vnd } from "../growth/format";

const TABS = ["Dashboard", "Pipeline", "Scoring"] as const;
type Tab = (typeof TABS)[number];

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  assigned: "Assigned",
  contacted: "Contacted",
  placement: "Placement test done",
  offer: "First invoice issued",
  enrolled: "Enrolled",
  lost: "Lost",
};
const SOURCE_LABEL: Record<string, string> = {
  referral: "Referral",
  walk_in: "Walk-in",
  website: "Website",
  event: "Event",
  phone: "Phone enquiry",
};
const CHANNEL_LABEL: Record<ContactChannel, string> = {
  zalo: "Zalo",
  phone: "Phone call",
  email: "E-mail",
  in_person: "In person",
};
const NEED_LABEL: Record<LearningNeed, string> = {
  exam_prep: "Exam preparation",
  speaking_confidence: "Speaking confidence",
  school_support: "School support",
  work_english: "English for work",
  travel: "Travel",
  young_learner: "Young learner",
};
const PART_LABEL: Record<ScoreKey, string> = {
  source: "Lead source",
  course_fit: "Course fit",
  engagement: "Engagement",
  recency: "Recency",
  progress: "Stage progress",
};
const KIND_LABEL: Record<LeadActivityKind, string> = {
  call: "Call",
  message: "Message",
  meeting: "Meeting",
  note: "Note",
};
const BAND_STYLE = { hot: "text-danger", warm: "text-brand", cold: "text-muted" } as const;
const REFUSAL: Record<string, string> = {
  not_staff: "Only center staff can do this.",
  not_found: "Not found.",
  invalid: "Not valid",
  invalid_step: "Not at this step",
  access_policy: "Your access policy does not allow this.",
  no_fee_line: "No approved fee line",
};

type AnyResult = AdmissionsResult | BillingResult<object>;
function useAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<AnyResult>) => run(),
    onSuccess: () => refreshLearningState(qc),
  });
}
function Refused({ r }: { r: AnyResult | undefined }) {
  if (!r || r.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[r.reason] ?? r.reason}
      {r.detail ? `: ${r.detail}` : ""}
    </p>
  );
}
const pctText = (r: Ratio) => (r.pct === null ? "—" : `${r.pct}%`);
const tabClass = (on: boolean) =>
  `px-3 py-2 text-sm ${on ? "border-b-2 border-brand font-medium text-brand" : "text-muted"}`;

export function AdmissionsPage() {
  const viewer = useViewer();
  const [tab, setTab] = useState<Tab>("Dashboard");
  const d = useQuery({
    queryKey: ["adm-dashboard", viewer],
    queryFn: () => admissions.getDashboard(viewer),
  });
  if (d.isLoading) return <Spinner label="Loading admissions" />;
  if (d.isError)
    return <ErrorState message="Could not load admissions." onRetry={() => d.refetch()} />;
  if (!d.data) return <EmptyState title="Admissions is for center staff" />;
  return (
    <section className="space-y-4">
      <PageHeader title="Admissions" subtitle="Pipeline · lead score · funnel · synthetic demo" />
      <p className="text-xs text-muted">
        One pipeline for every lead, referrals included. Synthetic names only — no phone numbers,
        e-mail addresses or family finances. Every rate shows what it is counted from.
      </p>
      <AccessBanner />
      <div role="tablist" aria-label="Admissions" className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={tabClass(tab === t)}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Dashboard" ? <Dashboard /> : null}
      {tab === "Pipeline" ? <Pipeline /> : null}
      {tab === "Scoring" ? <Scoring /> : null}
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Center operations
      </Link>
    </section>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────────────────────

function Dashboard() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["adm-dashboard", viewer],
    queryFn: () => admissions.getDashboard(viewer),
  });
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Leads" value={d.total} hint={`${d.open} open · ${d.lost} lost`} />
        <StatTile
          label="Lead → enrolled"
          value={<span data-testid="lead-to-enrolled">{pctText(d.leadToEnrolled)}</span>}
          hint={`${d.leadToEnrolled.reached} of ${d.leadToEnrolled.of} leads`}
        />
        <StatTile
          label="First response"
          value={d.firstResponse.avgHours === null ? "—" : `${d.firstResponse.avgHours} h`}
          hint={`average of ${d.firstResponse.measured} of ${d.firstResponse.of} leads with a first contact`}
        />
        <StatTile
          label="Stale leads"
          value={<span data-testid="stale">{d.stale}</span>}
          hint={`open, no activity for more than ${d.staleDays} days`}
        />
      </div>
      <Card>
        <h2 className="mb-2 font-medium">Funnel</h2>
        <p className="mb-2 text-xs text-muted">
          A step counts every lead that ever reached it — a lost lead keeps the stages it reached.
        </p>
        <table className="w-full text-sm" aria-label="Funnel">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="py-1">Step</th>
              <th className="text-right">Reached</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Now at this stage</th>
            </tr>
          </thead>
          <tbody>
            {d.conversions.map((c) => (
              <tr key={c.to} className="border-t border-border">
                <td className="py-1">
                  {STAGE_LABEL[c.from]} → {STAGE_LABEL[c.to]}
                </td>
                <td className="text-right">
                  {c.reached} of {c.of}
                </td>
                <td className="text-right">{pctText(c)}</td>
                <td className="text-right">
                  {d.byStage.find((s) => s.stage === c.to)?.count ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <h2 className="mb-2 font-medium">Open leads by score</h2>
          <ul className="space-y-1 text-sm">
            {(["hot", "warm", "cold"] as const).map((b) => (
              <li key={b} className="flex justify-between">
                <span className={BAND_STYLE[b]}>{b[0].toUpperCase() + b.slice(1)}</span>
                <span>
                  {d.bands[b]} of {d.open}
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="mb-2 font-medium">By source</h2>
          <table className="w-full text-sm" aria-label="By source">
            <tbody>
              {d.bySource
                .filter((s) => s.leads > 0)
                .map((s) => (
                  <tr key={s.source} className="border-t border-border first:border-0">
                    <td className="py-1">{SOURCE_LABEL[s.source]}</td>
                    <td className="text-right">
                      {s.leads} {s.leads === 1 ? "lead" : "leads"}
                    </td>
                    <td className="text-right">
                      {s.reached} enrolled · {pctText(s)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Card>
      </div>
      <Card>
        <h2 className="mb-2 font-medium">Counselors</h2>
        <table className="w-full text-sm" aria-label="Counselors">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="py-1">Counselor</th>
              <th className="text-right">Assigned</th>
              <th className="text-right">Contacted</th>
              <th className="text-right">Enrolled</th>
              <th className="text-right">First response</th>
              <th className="text-right">Stale</th>
            </tr>
          </thead>
          <tbody>
            {d.counselors.map((c) => (
              <tr key={c.principalId} className="border-t border-border">
                <td className="py-1">{c.name}</td>
                <td className="text-right">{c.assigned}</td>
                <td className="text-right">{c.contacted}</td>
                <td className="text-right">
                  {c.enrolled} · {pctText(c.conversion)}
                </td>
                <td className="text-right">
                  {c.avgFirstResponseHours === null ? "—" : `${c.avgFirstResponseHours} h`}
                </td>
                <td className="text-right">{c.stale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ── Pipeline ────────────────────────────────────────────────────────────────────────────────

function Pipeline() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["adm-leads", viewer],
    queryFn: () => admissions.listLeads(viewer),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [band, setBand] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [adding, setAdding] = useState(false);
  if (!q.data) return <Spinner label="Loading leads" />;
  const list = q.data.filter((l) => band === "all" || l.score.band === band);
  const selected = q.data.find((l) => l.id === open) ?? null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          + New lead
        </Button>
        <label className="text-sm">
          <span className="sr-only">Score band</span>
          <select
            aria-label="Score band"
            className="rounded-ogc border border-border bg-surface p-1"
            value={band}
            onChange={(e) => setBand(e.target.value as typeof band)}
          >
            <option value="all">All scores</option>
            <option value="hot">Hot</option>
            <option value="warm">Warm</option>
            <option value="cold">Cold</option>
          </select>
        </label>
      </div>
      {adding ? <NewLead onDone={() => setAdding(false)} /> : null}
      <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Pipeline board">
        {[...FUNNEL, "lost" as LeadStage].map((stage) => {
          const col = list.filter((l) => l.stage === stage);
          return (
            <section
              key={stage}
              aria-label={STAGE_LABEL[stage]}
              className="w-56 shrink-0 space-y-2"
            >
              <h3 className="flex justify-between text-sm font-medium">
                <span>{STAGE_LABEL[stage]}</span>
                <span className="text-muted">{col.length}</span>
              </h3>
              {col.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  aria-label={`Open ${l.learnerName}`}
                  aria-pressed={open === l.id}
                  onClick={() => setOpen(open === l.id ? null : l.id)}
                  className={`block w-full rounded-ogc border bg-surface p-2 text-left text-sm ${open === l.id ? "border-brand" : "border-border"}`}
                >
                  <span className="flex justify-between gap-1">
                    <span className="font-medium">{l.learnerName}</span>
                    <span className={BAND_STYLE[l.score.band]}>
                      {l.score.total} {l.score.band}
                    </span>
                  </span>
                  <span className="block text-xs text-muted">
                    {l.courseCode} · {SOURCE_LABEL[l.source]}
                    {l.assignedTo ? ` · ${l.assignedTo.name.split(" ")[0]}` : ""}
                  </span>
                  {l.stale ? (
                    <span className="text-xs text-danger">No activity for a while</span>
                  ) : null}
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {selected ? <LeadDetail key={selected.id} lead={selected} /> : null}
    </div>
  );
}

function NewLead({ onDone }: { onDone: () => void }) {
  const viewer = useViewer();
  const act = useAction();
  const orgCenters = centers.filter((c) => c.orgId === viewer.orgId);
  const codes = courses.filter((c) => c.orgId === viewer.orgId).map((c) => c.code);
  const [d, setD] = useState<LeadDraft>({
    learnerName: "",
    courseCode: codes[0] ?? "",
    centerId: orgCenters[0]?.id ?? "",
    source: "walk_in",
    channel: null,
    needs: [],
    note: "",
  });
  const set = (p: Partial<LeadDraft>) => setD((x) => ({ ...x, ...p }));
  const field = "mt-1 block w-full rounded-ogc border border-border bg-surface p-1";
  return (
    <Card className="space-y-3">
      <h2 className="font-medium">New lead</h2>
      <p className="text-xs text-muted">
        Synthetic demo data only: a display name, no phone number or e-mail.
      </p>
      <div className="grid gap-3 text-sm sm:grid-cols-3">
        <label>
          Learner&apos;s name (synthetic)
          <input
            aria-label="Lead name"
            className={field}
            value={d.learnerName}
            onChange={(e) => set({ learnerName: e.target.value })}
          />
        </label>
        <label>
          Course
          <select
            aria-label="Lead course"
            className={field}
            value={d.courseCode}
            onChange={(e) => set({ courseCode: e.target.value })}
          >
            {codes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Center
          <select
            aria-label="Lead center"
            className={field}
            value={d.centerId}
            onChange={(e) => set({ centerId: e.target.value })}
          >
            {orgCenters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select
            aria-label="Lead source"
            className={field}
            value={d.source}
            onChange={(e) => set({ source: e.target.value as LeadDraft["source"] })}
          >
            {(["walk_in", "website", "event", "phone"] as const).map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Preferred channel
          <select
            aria-label="Lead channel"
            className={field}
            value={d.channel ?? ""}
            onChange={(e) => set({ channel: (e.target.value || null) as ContactChannel | null })}
          >
            <option value="">Not said</option>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Note (optional)
          <input
            aria-label="Lead note"
            className={field}
            value={d.note}
            onChange={(e) => set({ note: e.target.value })}
          />
        </label>
      </div>
      <fieldset className="text-sm">
        <legend className="mb-1">Learning needs</legend>
        <div className="flex flex-wrap gap-3">
          {LEARNING_NEEDS.map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={d.needs.includes(n)}
                onChange={(e) =>
                  set({
                    needs: e.target.checked ? [...d.needs, n] : d.needs.filter((x) => x !== n),
                  })
                }
              />
              {NEED_LABEL[n]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button
          onClick={() =>
            act.mutate(() => admissions.createLead(viewer, d), {
              onSuccess: (r) => (r.ok ? onDone() : undefined),
            })
          }
        >
          Add lead
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <Refused r={act.data} />
    </Card>
  );
}

function LeadDetail({ lead: l }: { lead: Lead }) {
  const viewer = useViewer();
  const act = useAction();
  const me = useMyAccess();
  const canBill = me.data?.allowed["billing:manage"] ?? true;
  const counselors = useQuery({
    queryKey: ["adm-counselors", viewer],
    queryFn: () => admissions.counselors(viewer),
  });
  const [who, setWho] = useState(l.assignedTo?.principalId ?? "");
  const [stage, setStage] = useState<LeadStage>(l.stage === "lost" ? "contacted" : l.stage);
  const [reason, setReason] = useState("");
  const [kind, setKind] = useState<LeadActivityKind>("call");
  const [text, setText] = useState("");
  const closed = l.stage === "enrolled";
  return (
    <Card className="space-y-3">
      <section aria-label={`Lead ${l.learnerName}`} className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-medium">{l.learnerName}</h2>
          <span className="text-sm">
            {STAGE_LABEL[l.stage]} ·{" "}
            <span className={BAND_STYLE[l.score.band]} data-testid="lead-score">
              {l.score.total}/100 {l.score.band}
            </span>
          </span>
        </div>
        <p className="text-sm text-muted">
          {l.courseCode} · {l.centerName} · {SOURCE_LABEL[l.source]}
          {l.referredBy ? ` from ${l.referredBy}` : ""} · since {formatCenterDate(l.createdAt)}
          {l.channel ? ` · prefers ${CHANNEL_LABEL[l.channel]}` : ""}
          {l.needs.length ? ` · ${l.needs.map((n) => NEED_LABEL[n]).join(", ")}` : ""}
          {l.note ? ` · “${l.note}”` : ""}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-medium">Why this score</h3>
            <table className="w-full text-sm" aria-label={`Score of ${l.learnerName}`}>
              <tbody>
                {l.score.parts.map((p) => (
                  <tr key={p.key} className="border-t border-border first:border-0">
                    <td className="py-0.5">{PART_LABEL[p.key]}</td>
                    <td className="text-muted">{p.why}</td>
                    <td className="text-right">
                      {p.points}/{p.max}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1 text-sm">
            <h3 className="font-medium">Stages</h3>
            <ol className="space-y-0.5">
              {l.stageHistory.map((h, i) => (
                <li key={i}>
                  {STAGE_LABEL[h.stage]}{" "}
                  <span className="text-muted">
                    · {formatCenterDateTime(h.at)} · {h.by}
                  </span>
                </li>
              ))}
            </ol>
            {l.lostReason ? <p className="text-muted">Lost: {l.lostReason}</p> : null}
            {l.invoiceNo ? (
              <p>
                First invoice {l.invoiceNo}
                {l.firstPaymentVnd
                  ? ` · paid ${vnd(l.firstPaymentVnd)}`
                  : " · waiting for payment"}{" "}
                (
                <Link className="text-brand underline" to="/app/operations/billing">
                  Billing
                </Link>
                )
              </p>
            ) : null}
          </div>
        </div>
        {!closed ? (
          <div className="flex flex-wrap items-end gap-2 text-sm">
            <label>
              <span className="block text-xs text-muted">Counselor</span>
              <select
                aria-label={`Counselor for ${l.learnerName}`}
                className="rounded-ogc border border-border bg-surface p-1"
                value={who}
                onChange={(e) => setWho(e.target.value)}
              >
                <option value="">—</option>
                {(counselors.data ?? []).map((c) => (
                  <option key={c.principalId} value={c.principalId}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              disabled={!who}
              onClick={() => act.mutate(() => admissions.assign(viewer, l.id, who))}
            >
              Assign · {l.learnerName}
            </Button>
            {l.stage !== "offer" ? (
              <>
                <label>
                  <span className="block text-xs text-muted">Stage</span>
                  <select
                    aria-label={`Stage for ${l.learnerName}`}
                    className="rounded-ogc border border-border bg-surface p-1"
                    value={stage}
                    onChange={(e) => setStage(e.target.value as LeadStage)}
                  >
                    {MANUAL_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {stage === "lost" ? (
                  <input
                    aria-label={`Reason lost for ${l.learnerName}`}
                    placeholder="Why was it lost?"
                    className="rounded-ogc border border-border bg-surface p-1"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  onClick={() =>
                    act.mutate(() => admissions.moveStage(viewer, l.id, stage, reason))
                  }
                >
                  Move · {l.learnerName}
                </Button>
              </>
            ) : null}
            {l.stage === "placement" ? (
              <Button
                disabled={!canBill}
                onClick={() => act.mutate(() => billing.issueFirstInvoice(viewer, l.id))}
              >
                Issue first invoice · {l.learnerName}
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <select
            aria-label={`Activity kind for ${l.learnerName}`}
            className="rounded-ogc border border-border bg-surface p-1"
            value={kind}
            onChange={(e) => setKind(e.target.value as LeadActivityKind)}
          >
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input
            aria-label={`Activity for ${l.learnerName}`}
            placeholder="What happened (no phone numbers)"
            className="min-w-64 flex-1 rounded-ogc border border-border bg-surface p-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <Button
            variant="ghost"
            onClick={() =>
              act.mutate(() => admissions.logActivity(viewer, l.id, kind, text), {
                onSuccess: (r) => (r.ok ? setText("") : undefined),
              })
            }
          >
            Log · {l.learnerName}
          </Button>
        </div>
        <Refused r={act.data} />
        {l.activities.length ? (
          <ul className="space-y-1 text-sm" aria-label={`Activities of ${l.learnerName}`}>
            {l.activities.map((a) => (
              <li key={a.id}>
                <span className="font-medium">{KIND_LABEL[a.kind]}</span> {a.text}{" "}
                <span className="text-muted">
                  · {formatCenterDateTime(a.at)} · {a.by}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No activity yet.</p>
        )}
      </section>
    </Card>
  );
}

// ── Scoring ─────────────────────────────────────────────────────────────────────────────────

function Scoring() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["adm-settings", viewer],
    queryFn: () => admissions.getSettings(viewer),
  });
  if (!q.data) return <Spinner label="Loading scoring" />;
  return <ScoringForm key={JSON.stringify(q.data)} settings={q.data} />;
}

function ScoringForm({ settings }: { settings: ScoringSettings }) {
  const viewer = useViewer();
  const act = useAction();
  const me = useMyAccess();
  const can = me.data?.allowed["admissions:manage"] ?? true;
  const [s, setS] = useState<ScoringSettings>(settings);
  const sum = SCORE_KEYS.reduce((t, k) => t + (s.max[k] || 0), 0);
  const num = "w-20 rounded-ogc border border-border bg-surface p-1";
  return (
    <Card className="space-y-3">
      <h2 className="font-medium">Lead score</h2>
      <p className="text-xs text-muted">
        The score is a sum of five parts, each with a reason on the lead. Points per part must add
        up to 100. No hidden model.
      </p>
      <div className="grid gap-2 text-sm sm:grid-cols-5">
        {SCORE_KEYS.map((k) => (
          <label key={k}>
            <span className="block">{PART_LABEL[k]}</span>
            <input
              aria-label={`Points for ${PART_LABEL[k]}`}
              type="number"
              className={num}
              disabled={!can}
              value={s.max[k]}
              onChange={(e) => setS({ ...s, max: { ...s.max, [k]: Number(e.target.value) } })}
            />
          </label>
        ))}
      </div>
      <p className={`text-sm ${sum === 100 ? "text-muted" : "text-danger"}`}>Total {sum} / 100</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>
          <span className="block">Hot from</span>
          <input
            aria-label="Hot from"
            type="number"
            className={num}
            disabled={!can}
            value={s.hotAt}
            onChange={(e) => setS({ ...s, hotAt: Number(e.target.value) })}
          />
        </label>
        <label>
          <span className="block">Warm from</span>
          <input
            aria-label="Warm from"
            type="number"
            className={num}
            disabled={!can}
            value={s.warmAt}
            onChange={(e) => setS({ ...s, warmAt: Number(e.target.value) })}
          />
        </label>
        <label>
          <span className="block">Stale after (days)</span>
          <input
            aria-label="Stale after"
            type="number"
            className={num}
            disabled={!can}
            value={s.staleDays}
            onChange={(e) => setS({ ...s, staleDays: Number(e.target.value) })}
          />
        </label>
      </div>
      <Button
        disabled={!can}
        onClick={() => act.mutate(() => admissions.updateSettings(viewer, s))}
      >
        Save scoring
      </Button>
      {act.data?.ok ? (
        <p role="status" className="text-sm">
          Saved — scores are recomputed.
        </p>
      ) : null}
      <Refused r={act.data} />
    </Card>
  );
}
