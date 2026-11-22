import type { IiosGrantedContext } from "@ogc/contracts";
import { useViewer } from "../../app/iiosGate";
/*
 * P1 · Speaking rehearsals waiting for the teacher (MOCK). Principle 04 — AI advises, educators
 * govern: a rehearsal counts toward Speaking only after the owning teacher approves it. The
 * teacher sees each turn (what the learner chose vs a natural model line) and either approves or
 * returns it with a note. Scoped server-side (mock) to learners on the teacher's own rosters.
 */
import { useState } from "react";
import type { SpeakingReviewItem } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, Spinner } from "../../ui";
import { usePendingSpeakingReviews, useReviewSpeaking } from "../learning/speaking/queries";

export function SpeakingReviewQueue() {
  const viewer = useViewer();
  const q = usePendingSpeakingReviews(viewer);

  return (
    <div>
      <h2 className="mb-3 text-lg font-medium">
        Speaking to review{q.data && q.data.length > 0 ? ` (${q.data.length})` : ""}
      </h2>
      {q.isLoading ? (
        <Spinner label="Loading speaking reviews" />
      ) : q.isError ? (
        <ErrorState message="Could not load speaking reviews." onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState
          title="Nothing to review"
          hint="Speaking rehearsals from your learners will appear here."
        />
      ) : (
        <ul className="space-y-3" aria-label="Speaking to review">
          {q.data.map((item) => (
            <li key={`${item.review.learnerId}:${item.review.activityId}`}>
              <ReviewCard viewer={viewer} item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewCard({ viewer, item }: { viewer: IiosGrantedContext; item: SpeakingReviewItem }) {
  const review = useReviewSpeaking(viewer);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  const { learnerId, activityId } = item.review;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">
          {item.learnerName} · {item.activityTitle}
        </p>
        <span className="text-sm text-muted">
          {item.result.correct} of {item.result.total} natural replies
        </span>
      </div>
      <ol className="space-y-1 text-sm" aria-label={`Turns from ${item.learnerName}`}>
        {item.turns.map((t, i) => (
          <li key={i} data-natural={t.natural ? "true" : "false"}>
            <span aria-hidden="true">{t.natural ? "✓" : "✗"}</span>{" "}
            <span className="text-muted">“{t.prompt}”</span> → {t.chosen ?? "—"}
            {!t.natural ? <span className="text-muted"> (natural: {t.modelLine})</span> : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">
        Mock rehearsal — no audio was recorded. Approving counts it toward Speaking.
      </p>

      {!returning ? (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={review.isPending}
            onClick={() => review.mutate({ learnerId, activityId, decision: "approve" })}
          >
            Approve for {item.learnerName}
          </Button>
          <Button variant="ghost" disabled={review.isPending} onClick={() => setReturning(true)}>
            Ask to try again
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            review.mutate({ learnerId, activityId, decision: "return", note });
          }}
        >
          <label className="block text-sm">
            <span className="text-muted">Note to {item.learnerName} (required)</span>
            <textarea
              className="mt-1 block w-full rounded-ogc border border-border bg-surface p-2 text-sm"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" disabled={note.trim().length === 0 || review.isPending}>
              Send back with note
            </Button>
            <Button variant="ghost" type="button" onClick={() => setReturning(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {review.data && !review.data.ok ? (
        <p role="alert" className="text-sm text-danger">
          Could not update this review ({review.data.reason}).
        </p>
      ) : null}
    </Card>
  );
}
