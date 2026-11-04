import { useState } from "react";
import type { InterventionReasonCode } from "@ogc/contracts";
import { Button, Card, EmptyState, Spinner } from "../../ui";
import { ALL_SKILLS, skillLabel } from "../learning/intelligence/skills";
import { confidenceWord, masteryWord } from "../learning/intelligence/friendly";
import {
  useActiveApplied,
  useApplyRecommendation,
  useRevertApplied,
  useTeacherLearnerView,
} from "./queries";

const REASON_CODES: InterventionReasonCode[] = [
  "pacing",
  "remediation",
  "learner_preference",
  "assessment_focus",
  "other",
];

/*
 * AUTH-026 — teacher learning-intelligence panel. Read-only mastery/confidence/prerequisite
 * view, the always-present SYSTEM SUGGESTED recommendation, and the TEACHER RECOMMENDED
 * (applied) recommendation that reaches the learner. Applying picks an AVAILABLE activity with
 * a required reason; reverting restores the system suggestion. Synthetic + fail-closed.
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
  const active = useActiveApplied(viewerPersonaId, learnerId);
  const apply = useApplyRecommendation(viewerPersonaId, learnerId);
  const revert = useRevertApplied(viewerPersonaId, learnerId);

  const [selected, setSelected] = useState("");
  const [reasonCode, setReasonCode] = useState<InterventionReasonCode>("pacing");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  if (view.isLoading) return <Spinner label="Loading learner intelligence" />;
  if (!view.data) return <EmptyState title="Not authorized to view this learner" />;

  const v = view.data;
  const sys = v.path.nextStep;
  const available = v.path.steps.filter((s) => s.state === "available");
  const titleOf = (id: string) => v.path.steps.find((s) => s.activityId === id)?.title ?? id;

  const doApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!selected) {
      setError("Select an activity.");
      return;
    }
    const res = await apply.mutateAsync({ selectedActivityId: selected, reasonCode, note });
    if (!res.ok) setError(res.reason ?? "Could not apply.");
    else {
      setNote("");
      setSelected("");
    }
  };

  return (
    <Card className="space-y-4" aria-label={`Learning intelligence for ${learnerName}`}>
      {/* Mastery + confidence, plain language */}
      <div>
        <p className="mb-1 text-sm font-medium">Where {learnerName} is · CEFR {v.profile.cefrBand}</p>
        <ul className="space-y-0.5 text-sm" aria-label="Mastery by skill">
          {ALL_SKILLS.map((s) => (
            <li key={s} className="flex justify-between">
              <span>{skillLabel(s)}</span>
              <span className="text-muted">
                {masteryWord(v.profile.skills[s].level)} · {confidenceWord(v.confidence.skills[s].band)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* System Suggested (always) */}
      <div className="rounded-ogc border border-border bg-surface p-2 text-sm">
        <p className="text-xs uppercase tracking-wide text-muted">System suggested</p>
        <p data-testid="ti-system-rec">
          {sys.recommendation ? titleOf(sys.recommendation.activityId) : "nothing due"}{" "}
          <span className="text-xs text-muted">· {sys.reasonCode}</span>
        </p>
        <p className="mt-1 text-xs text-muted">{sys.reason}</p>
      </div>

      {/* Teacher Recommended (applied → reaches the learner) */}
      <div className="rounded-ogc border border-brand/40 bg-brand/5 p-2 text-sm" data-testid="ti-teacher-rec">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-muted">Teacher recommended</p>
          {active.data ? (
            <Button variant="ghost" onClick={() => revert.mutate()} aria-label="Revert to system suggestion">
              Revert to system
            </Button>
          ) : null}
        </div>
        {active.data ? (
          <>
            <p data-testid="ti-teacher-active">
              {titleOf(active.data.activityId)} <span className="text-xs text-muted">· {active.data.reasonCode}</span>
            </p>
            <p className="mt-1 text-xs text-muted">
              {active.data.note} · reaching the learner now
            </p>
          </>
        ) : (
          <p className="text-muted">None — the learner is following the system suggestion.</p>
        )}
      </div>

      {/* Prerequisite journey */}
      <div>
        <p className="mb-1 text-sm font-medium">Learning journey</p>
        <ul className="space-y-0.5 text-sm" aria-label="Prerequisite status">
          {v.path.steps.map((s) => (
            <li key={s.activityId} data-state={s.state} className="flex justify-between">
              <span>{s.title}</span>
              <span className="text-xs text-muted">
                {s.state}
                {s.state === "blocked" && s.blockedBy.length > 0
                  ? ` · needs ${s.blockedBy.map(titleOf).join(", ")}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Apply an eligible alternative — reaches the learner */}
      <form onSubmit={doApply} className="space-y-2" aria-label="Apply an alternative activity">
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
          Apply for learner
        </Button>
      </form>
    </Card>
  );
}
