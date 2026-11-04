import { useState } from "react";
import type { InterventionReasonCode } from "@ogc/contracts";
import { Button, Card, EmptyState, Spinner } from "../../ui";
import { ALL_SKILLS, skillLabel } from "../learning/intelligence/skills";
import { useIntervene, useInterventions, useTeacherLearnerView } from "./queries";

const REASON_CODES: InterventionReasonCode[] = [
  "pacing",
  "remediation",
  "learner_preference",
  "assessment_focus",
  "other",
];

/*
 * LI-4 — read-only teacher learning-intelligence view for one learner, plus a synthetic
 * intervention (choose an AVAILABLE alternative with a required reason). The system
 * recommendation is always shown and never overwritten; the teacher's choice is displayed
 * alongside it and recorded as an audit event. All data is synthetic and authz is fail-closed.
 */
export function LearnerIntelligencePanel({
  viewerPersonaId,
  learnerId,
  learnerName,
}: {
  viewerPersonaId: string;
  learnerId: string;
  learnerName: string;
}) {
  const view = useTeacherLearnerView(viewerPersonaId, learnerId);
  const interventions = useInterventions(viewerPersonaId, learnerId);
  const intervene = useIntervene(viewerPersonaId, learnerId);

  const [selected, setSelected] = useState("");
  const [reasonCode, setReasonCode] = useState<InterventionReasonCode>("pacing");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  if (view.isLoading) return <Spinner label="Loading learner intelligence" />;
  if (!view.data) return <EmptyState title="Not authorized to view this learner" />;

  const v = view.data;
  const sys = v.path.nextStep;
  const available = v.path.steps.filter((s) => s.state === "available");
  const audit = interventions.data ?? [];
  const latest = audit.length > 0 ? audit[audit.length - 1] : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!selected) {
      setError("Select an activity.");
      return;
    }
    const res = await intervene.mutateAsync({ selectedActivityId: selected, reasonCode, note });
    if (!res.ok) setError(res.reason ?? "Intervention rejected.");
    else {
      setNote("");
      setSelected("");
    }
  };

  return (
    <Card className="space-y-4" aria-label={`Learning intelligence for ${learnerName}`}>
      {/* Mastery + confidence by skill */}
      <div>
        <p className="mb-1 text-sm font-medium">Mastery &amp; confidence · CEFR {v.profile.cefrBand}</p>
        <ul className="space-y-0.5 text-sm" aria-label="Mastery by skill">
          {ALL_SKILLS.map((s) => (
            <li key={s} className="flex justify-between">
              <span>{skillLabel(s)}</span>
              <span className="text-muted">
                mastery {v.profile.skills[s].level} · {v.confidence.skills[s].band} confidence
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* System recommendation (preserved) */}
      <div className="rounded-ogc border border-border bg-surface p-2 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted">System recommendation</p>
        <p data-testid="ti-system-rec">
          {sys.recommendation
            ? `${sys.recommendation.activityId} — ${sys.reasonCode}`
            : `none — ${sys.reasonCode}`}
        </p>
        <p className="mt-1 text-xs text-muted">{sys.reason}</p>
      </div>

      {/* Prerequisite status */}
      <div>
        <p className="mb-1 text-sm font-medium">Prerequisite status</p>
        <ul className="space-y-0.5 text-sm" aria-label="Prerequisite status">
          {v.path.steps.map((s) => (
            <li key={s.activityId} data-state={s.state} className="flex justify-between">
              <span>{s.title}</span>
              <span className="text-xs text-muted">
                {s.state}
                {s.state === "blocked" && s.blockedBy.length > 0 ? ` · needs ${s.blockedBy.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Teacher-selected recommendation (if any) vs system */}
      {latest ? (
        <div className="rounded-ogc border border-brand/40 bg-brand/5 p-2 text-sm" data-testid="ti-teacher-rec">
          <p className="text-xs uppercase tracking-wide text-muted">Teacher-selected</p>
          <p>
            {latest.selectedActivityId} · {latest.reasonCode}
            {latest.systemActivityId ? ` (system: ${latest.systemActivityId})` : ""}
          </p>
          <p className="mt-1 text-xs text-muted">{latest.note}</p>
        </div>
      ) : null}

      {/* Intervention form — only AVAILABLE activities are selectable */}
      <form onSubmit={submit} className="space-y-2" aria-label="Recommend an alternative activity">
        <label className="block text-sm">
          Alternative activity
          <select
            aria-label="Alternative activity"
            className="mt-1 block w-full rounded-ogc border border-border bg-surface px-2 py-1 text-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select an eligible activity…</option>
            {available.map((s) => (
              <option key={s.activityId} value={s.activityId}>
                {s.title} ({skillLabel(s.skill)})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Reason
          <select
            aria-label="Reason code"
            className="mt-1 block w-full rounded-ogc border border-border bg-surface px-2 py-1 text-sm"
            value={reasonCode}
            onChange={(e) => setReasonCode(e.target.value as InterventionReasonCode)}
          >
            {REASON_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Note
          <input
            aria-label="Intervention note"
            className="mt-1 block w-full rounded-ogc border border-border bg-surface px-2 py-1 text-sm"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this alternative?"
          />
        </label>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" variant="ghost">
          Record recommendation
        </Button>
      </form>
    </Card>
  );
}
