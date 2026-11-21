import { refreshLearningState } from "../../lib/invalidate";
/*
 * P1 · Learners needing support (owning teacher). Evidence first (owner decision 21/11): each
 * flag says WHY and FROM WHAT — a placement-only estimate is labelled as such. Acting reuses
 * AUTH-026: assigning sets the learner's next step (it reaches their Today's mission); the
 * teacher must give a reason, exactly as in the learner overview.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupportItem, SupportSignal } from "@ogc/contracts";
import { appliedRecommendation, support } from "../../lib/api";
import { useSession } from "../../app/session";
import { Button, Card, EmptyState, ErrorState, Spinner } from "../../ui";
import { skillLabel } from "../learning/intelligence/skills";

const SOURCE_LABEL: Record<SupportSignal["source"], string> = {
  placement: "placement test only",
  practice: "from practice",
  teacher_review: "teacher review",
  attendance: "attendance record",
};

// Badge: what the flag rests on. Practice / teacher review beats attendance beats placement.
export function evidenceLabel(item: SupportItem): {
  kind: "practice" | "attendance" | "placement";
  text: string;
} {
  if (item.signals.some((s) => s.source === "practice" || s.source === "teacher_review"))
    return { kind: "practice", text: "Evidence from practice" };
  if (item.signals.some((s) => s.source === "attendance"))
    return { kind: "attendance", text: "Attendance record" };
  return { kind: "placement", text: "Placement only" };
}

export function signalText(s: SupportSignal): string {
  const skill = s.skill ? skillLabel(s.skill) : "";
  if (s.kind === "skill_drop")
    return `${skill} dropped ${Math.abs(s.delta ?? 0)} to ${s.level} after the latest practice`;
  if (s.kind === "low_skill") return `${skill} is ${s.level} (below ${s.threshold ?? 60})`;
  if (s.kind === "absences") return `Absent from the last ${s.sessions ?? 0} sessions`;
  return "Speaking rehearsal was returned for another try";
}

export function NeedsSupportQueue() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  const q = useQuery({
    queryKey: ["support", viewer],
    queryFn: () => support.listNeedsSupport(viewer),
    enabled: viewer.length > 0,
  });

  return (
    <div>
      <h2 className="mb-1 text-lg font-medium">
        Learners needing support{q.data && q.data.length > 0 ? ` (${q.data.length})` : ""}
      </h2>
      <p className="mb-3 text-xs text-muted">
        Evidence from practice or attendance is listed first. Placement-only estimates are marked —
        check them before acting.
      </p>
      {q.isLoading ? (
        <Spinner label="Loading learners needing support" />
      ) : q.isError ? (
        <ErrorState
          message="Could not load learners needing support."
          onRetry={() => q.refetch()}
        />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState title="No learner needs support right now" />
      ) : (
        <ul className="space-y-3" aria-label="Learners needing support">
          {q.data.map((item) => (
            <li key={item.learnerId}>
              <SupportCard viewer={viewer} item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SupportCard({ viewer, item }: { viewer: string; item: SupportItem }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  // Built when the form OPENS (not on mount): the item may refresh after a cached first paint.
  const defaultNote = () =>
    item.suggestionUnlocksTitle
      ? `Unlocks “${item.suggestionUnlocksTitle}”`
      : item.focusSkill
        ? `Targeted practice for ${skillLabel(item.focusSkill)}`
        : "Targeted practice";
  const [note, setNote] = useState("");
  const assign = useMutation({
    mutationFn: () =>
      appliedRecommendation.applyRecommendation(viewer, item.learnerId, {
        selectedActivityId: item.suggestedActivityId!,
        reasonCode: "remediation",
        note,
      }),
    onSuccess: () => refreshLearningState(qc),
  });

  const badge = evidenceLabel(item);
  return (
    <Card className="space-y-2">
      <div data-evidence={badge.kind} className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-medium">
            {item.learnerName}{" "}
            <span className="text-sm font-normal text-muted">· {item.className}</span>
          </p>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${
              badge.kind === "placement" ? "border-border text-muted" : "border-brand text-brand"
            }`}
          >
            {badge.text}
          </span>
        </div>
        <ul className="space-y-1 text-sm" aria-label={`Why ${item.learnerName} is flagged`}>
          {item.signals.map((s, i) => (
            <li key={i} data-kind={s.kind}>
              • {signalText(s)}{" "}
              <span className="text-xs text-muted">({SOURCE_LABEL[s.source]})</span>
            </li>
          ))}
        </ul>

        {item.activeAssignmentTitle ? (
          <p className="text-sm" data-testid={`assigned-${item.learnerId}`}>
            <span className="text-muted">Assigned next:</span> {item.activeAssignmentTitle}
          </p>
        ) : item.suggestedActivityId ? (
          !open ? (
            <div className="flex flex-wrap items-center gap-3">
              {item.suggestionUnlocksTitle ? (
                <span className="text-sm" data-testid={`unlock-${item.learnerId}`}>
                  {item.focusSkill ? skillLabel(item.focusSkill) : "This skill"} is locked behind “
                  {item.suggestedTitle}” — assign that first
                </span>
              ) : (
                <span className="text-sm">
                  <span className="text-muted">Suggested:</span> {item.suggestedTitle}
                </span>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  setNote(defaultNote());
                  setOpen(true);
                }}
              >
                Assign to {item.learnerName}
              </Button>
            </div>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                assign.mutate();
              }}
            >
              <label className="block text-sm">
                <span className="text-muted">
                  Reason (shown to {item.learnerName} as your note)
                </span>
                <input
                  className="mt-1 block w-full rounded-ogc border border-border bg-surface p-2 text-sm"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <div className="flex gap-2">
                <Button type="submit" disabled={note.trim().length === 0 || assign.isPending}>
                  Assign “{item.suggestedTitle}”
                </Button>
                <Button variant="ghost" type="button" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
              {assign.data && !assign.data.ok ? (
                <p role="alert" className="text-sm text-danger">
                  Could not assign ({assign.data.reason}).
                </p>
              ) : null}
            </form>
          )
        ) : !item.focusSkill ? (
          <p className="text-sm text-muted">
            No skill flagged — check in with {item.learnerName} about attendance.
          </p>
        ) : (
          <p className="text-sm text-muted">
            No open activity for {item.focusSkill ? skillLabel(item.focusSkill) : "this skill"}{" "}
            right now — see the learner overview.
          </p>
        )}
      </div>
    </Card>
  );
}
