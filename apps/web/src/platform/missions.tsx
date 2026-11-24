// Mission Box review on the Platform (owner 24/11, Course Studio blocks part B): the class teacher
// approves a real-world mission the learner confirmed — it then earns XP ("Mission approved") and
// the Explorer badge, never skill evidence — or returns it with a note so the learner can send it
// again. Center staff see the queue but do not review. The demo has no review. Synthetic data.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AuthoringResult, MissionReviewItem } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, Spinner } from "../ui";
import { formatCenterDateTime } from "../lib/centerTime";
import { platformApi } from "./client";
import { useSignedIn } from "./App";

export function MissionReviewCard() {
  const s = useSignedIn();
  const q = useQuery({
    queryKey: ["mission-reviews", s.principalId],
    queryFn: () => platformApi.missionReviews(s),
  });
  if (q.isLoading) return <Spinner label="Loading missions" />;
  if (q.isError)
    return <ErrorState message="Could not load missions." onRetry={() => q.refetch()} />;
  if (!q.data) return null; // not a teacher or staff with this view
  return (
    <Card>
      <section aria-label="Missions to review" className="space-y-3">
        <h2 className="font-medium">Missions</h2>
        <p className="text-sm text-muted">
          {q.data.mayReview
            ? "Approve a mission to give its XP (not a skill score), or return it with a note so the learner can send it again."
            : "The class teacher reviews these; you see the queue."}
        </p>
        {q.data.items.length ? (
          <ul className="space-y-3">
            {q.data.items.map((i) => (
              <MissionItem
                key={`${i.learnerId}|${i.ref}|${i.lessonId}|${i.blockId}|${i.attempt}`}
                item={i}
                mayReview={q.data!.mayReview}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title="No mission waiting." />
        )}
      </section>
    </Card>
  );
}

function MissionItem({ item, mayReview }: { item: MissionReviewItem; mayReview: boolean }) {
  const s = useSignedIn();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (d: "approve" | "return") => platformApi.decideMission(s, item, d, note),
    onSuccess: (r) => (r.ok ? qc.invalidateQueries() : undefined),
  });
  const r = decide.data as AuthoringResult | undefined;
  const label = `${item.learnerName} — ${item.title}`;
  return (
    <li className="border-t border-border pt-2" aria-label={label}>
      <p className="font-medium">
        {item.learnerName} · {item.className}
      </p>
      <p className="text-sm text-muted">
        {item.courseTitle} · {item.lessonTitle} · 🧭 “{item.title}”
        {item.attempt > 1 ? ` · try ${item.attempt}` : ""} · sent{" "}
        {formatCenterDateTime(item.submittedAt)}
      </p>
      <p className="my-1 text-sm">Mission: {item.task}</p>
      <p className="text-sm">
        {item.note ? (
          <>Learner’s note: “{item.note}”</>
        ) : (
          <span className="text-muted">No note.</span>
        )}
      </p>
      {mayReview ? (
        <div className="mt-2 space-y-2">
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
