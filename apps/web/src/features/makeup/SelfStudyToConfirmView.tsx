/*
 * P2 · Self-study make-ups waiting for the class teacher. Owner decision (21/11): self-study
 * counts as a make-up only once the learner's own class teacher confirms it. The teacher can
 * confirm, or send it back with a note.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MakeupItem, MakeupItemResult } from "@ogc/contracts";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card } from "../../ui";
import { useMakeupApi } from "./makeupApi";

export function SelfStudyToConfirmView() {
  const api = useMakeupApi();
  const q = useQuery({
    queryKey: [...api.key, "makeup-to-confirm"],
    queryFn: () => api.listToConfirm(),
  });
  if (!q.data || q.data.length === 0) return null; // nothing to do → no section
  return (
    <section aria-label="Self-study to confirm">
      <h2 className="mb-3 text-lg font-medium">Self-study to confirm ({q.data.length})</h2>
      <ul className="space-y-2">
        {q.data.map((i) => (
          <li key={i.id}>
            <ConfirmCard item={i} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ConfirmCard({ item }: { item: MakeupItem }) {
  const api = useMakeupApi();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (run: () => Promise<MakeupItemResult>) => run(),
    onSuccess: () => api.onChanged(qc),
  });
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Card className="space-y-2">
      <p>
        <span className="font-medium">{item.learnerName}</span>{" "}
        <span className="text-sm text-muted">
          · make-up for {item.unitTitle} (missed {formatCenterDate(item.missedAt)})
        </span>
      </p>
      <p className="text-sm">
        <span className="text-muted">What {item.learnerName} studied:</span> “
        {item.booking?.selfStudy?.note}”
      </p>
      {!returning ? (
        <div className="flex gap-2">
          <Button onClick={() => act.mutate(() => api.confirmSelfStudy(item.id))}>
            Confirm make-up · {item.learnerName}
          </Button>
          <Button variant="ghost" onClick={() => setReturning(true)}>
            Send back
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate(() => api.returnSelfStudy(item.id, note));
          }}
        >
          <label className="text-sm">
            <span className="block text-muted">What is missing?</span>
            <input
              className="mt-1 rounded-ogc border border-border bg-surface p-1.5"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={!note.trim() || act.isPending}>
            Send back to {item.learnerName}
          </Button>
        </form>
      )}
    </Card>
  );
}
