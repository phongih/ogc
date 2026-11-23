// Speaking review on the Platform (owner 23/11, slice 5): the class teacher approves a learner's
// speaking rehearsal — it then counts for Speaking — or returns it with a note for another try.
// Center staff see the queue but do not review. The demo has no review (its Speaking studio keeps
// its own flow). Synthetic data.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthoringResult, CourseSpeakingReviewItem } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, Spinner } from "../ui";
import { formatCenterDateTime } from "../lib/centerTime";
import { platformApi } from "./client";
import { useSignedIn } from "./App";

export function SpeakingReviewCard() {
  const s = useSignedIn();
  const q = useQuery({
    queryKey: ["speaking-reviews", s.principalId],
    queryFn: () => platformApi.speakingReviews(s),
  });
  if (q.isLoading) return <Spinner label="Loading speaking rehearsals" />;
  if (q.isError)
    return <ErrorState message="Could not load speaking rehearsals." onRetry={() => q.refetch()} />;
  if (!q.data) return null; // not a teacher or staff with this view
  return (
    <Card>
      <section aria-label="Speaking rehearsals to review" className="space-y-3">
        <h2 className="font-medium">Speaking rehearsals</h2>
        <p className="text-sm text-muted">
          {q.data.mayReview
            ? "Approve a rehearsal to count it for Speaking, or return it with a note for another try."
            : "The class teacher reviews these; you see the queue."}
        </p>
        {q.data.items.length ? (
          <ul className="space-y-3">
            {q.data.items.map((i) => (
              <ReviewItem
                key={`${i.learnerId}|${i.ref}|${i.lessonId}|${i.blockId}|${i.attempt}`}
                item={i}
                mayReview={q.data!.mayReview}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title="No rehearsal waiting." />
        )}
      </section>
    </Card>
  );
}

function ReviewItem({ item, mayReview }: { item: CourseSpeakingReviewItem; mayReview: boolean }) {
  const s = useSignedIn();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (d: "approve" | "return") => platformApi.decideSpeaking(s, item, d, note),
    onSuccess: (r) => (r.ok ? qc.invalidateQueries() : undefined),
  });
  const r = decide.data as AuthoringResult | undefined;
  const label = `${item.learnerName} — ${item.scenario}`;
  return (
    <li className="border-t border-border pt-2" aria-label={label}>
      <p className="font-medium">
        {item.learnerName} · {item.className}
      </p>
      <p className="text-sm text-muted">
        {item.courseTitle} · {item.lessonTitle} · “{item.scenario}”
        {item.attempt > 1 ? ` · try ${item.attempt}` : ""} · sent{" "}
        {formatCenterDateTime(item.submittedAt)} · natural replies {item.score}%
      </p>
      <ol className="my-2 space-y-1 text-sm">
        {item.turns.map((t, n) => (
          <li key={n}>
            <span className="text-muted">Coach: “{t.coach}”</span>
            <br />
            {t.natural ? "✓" : "✗"} “{t.chosen ?? "—"}”
            {t.natural ? "" : <span className="text-muted"> · natural: “{t.model}”</span>}
          </li>
        ))}
      </ol>
      {mayReview ? (
        <div className="space-y-2">
          <label className="block text-sm">
            Note for the learner (needed to return)
            <textarea
              className="mt-1 block w-full rounded border border-border p-2"
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => decide.mutate("approve")}
              disabled={decide.isPending}
              aria-label={`Approve ${label}`}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              onClick={() => decide.mutate("return")}
              disabled={decide.isPending || note.trim().length < 3}
              aria-label={`Return ${label}`}
            >
              Return with note
            </Button>
            {r && !r.ok ? (
              <span role="alert" className="text-sm text-danger">
                {r.detail ?? r.reason}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
