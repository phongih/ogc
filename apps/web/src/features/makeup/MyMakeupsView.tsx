/*
 * P2 · The learner's own make-up lessons (and, read-only, a linked guardian's view). Owner,
 * 21/11: no learner loses a lesson — every missed unit is shown until it is made up, with where /
 * when, or the self-study to do and submit for the class teacher to confirm.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MakeupItem } from "@ogc/contracts";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card } from "../../ui";
import { MAKEUP_STATUS, bookingText } from "../operations/makeupText";
import { useMakeupApi } from "./makeupApi";

export function MyMakeupsView({
  readOnly = false,
  learnerId,
}: {
  readOnly?: boolean;
  learnerId?: string;
}) {
  const api = useMakeupApi();
  const q = useQuery({
    queryKey: [...api.key, "makeup-mine"],
    queryFn: () => api.listMine(),
  });
  const items = (q.data ?? []).filter((i) => !learnerId || i.learnerId === learnerId);
  if (items.length === 0) return null; // nothing missed → nothing to show
  const open = items.filter((i) => i.status !== "done").length;
  return (
    <section aria-label="Make-up lessons" className="space-y-2">
      <h2 className="text-lg font-medium">Make-up lessons{open ? ` (${open} to do)` : ""}</h2>
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id}>
            <MakeupRow item={i} readOnly={readOnly} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function MakeupRow({ item, readOnly }: { item: MakeupItem; readOnly: boolean }) {
  const api = useMakeupApi();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const submit = useMutation({
    mutationFn: () => api.submitSelfStudy(item.id, note),
    onSuccess: () => api.onChanged(qc),
  });
  const canSubmit = !readOnly && item.booking?.kind === "selfstudy" && item.status === "booked";
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-medium">{item.unitTitle}</span>{" "}
          <span className="text-sm text-muted">
            · missed {formatCenterDate(item.missedAt)} · make up by {formatCenterDate(item.dueAt)}
          </span>
        </p>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${
            item.overdue
              ? "border-danger text-danger"
              : item.status === "done"
                ? "border-border text-muted"
                : "border-brand text-brand"
          }`}
        >
          {item.overdue ? "Overdue · " : ""}
          {MAKEUP_STATUS[item.status]}
        </span>
      </div>
      <p className="text-sm">
        {item.booking
          ? bookingText(item)
          : "The center will arrange your make-up and let you know."}
      </p>
      {item.missedMakeup ? (
        <p className="text-sm text-danger">
          You missed the make-up too — the center will arrange another.
        </p>
      ) : null}
      {canSubmit ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <label className="block text-sm">
            <span className="text-muted">
              Study {item.unitTitle} on your own, then tell your teacher what you covered
            </span>
            <textarea
              className="mt-1 block w-full rounded-ogc border border-border bg-surface p-2 text-sm"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={note.trim().length < 10 || submit.isPending}>
            Send to my teacher
          </Button>
        </form>
      ) : null}
    </Card>
  );
}
