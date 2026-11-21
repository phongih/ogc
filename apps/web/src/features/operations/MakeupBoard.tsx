/*
 * P2 · Make-up lessons (staff). "No learner loses a lesson" (owner, 21/11): every absence in a
 * learner's own class is listed here until the learner attends a make-up — join another class's
 * session of the same unit, or a make-up session opened for everyone missing that unit.
 * Deadline 14 days; overdue items come first.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MakeupItem, MakeupResult, TeacherRef } from "@ogc/contracts";
import { makeup } from "../../lib/api";
import { refreshLearningState } from "../../lib/invalidate";
import {
  centerLocalToIso,
  formatCenterDate,
  formatCenterDateTime,
  isoToCenterLocal,
} from "../../lib/centerTime";
import { Button, Card, ErrorState, Spinner } from "../../ui";

const REFUSAL: Record<string, string> = {
  not_staff: "Only center staff can arrange make-ups.",
  not_found: "That make-up item no longer exists (the absence may have been corrected).",
  already_done: "Already made up.",
  not_an_option: "That session is not a make-up option for this unit.",
  in_past: "Pick a time in the future (center time).",
  unknown_teacher: "Unknown teacher.",
  nothing_open: "Nobody is still missing this unit.",
};

const STATUS: Record<MakeupItem["status"], string> = {
  open: "Needs a make-up",
  booked: "Booked",
  done: "Made up",
};

export function MakeupBoard({ viewer, teachers }: { viewer: string; teachers: TeacherRef[] }) {
  const q = useQuery({
    queryKey: ["makeup-board", viewer],
    queryFn: () => makeup.getBoard(viewer),
    enabled: !!viewer,
  });
  if (q.isLoading) return <Spinner label="Loading make-up lessons" />;
  if (q.isError)
    return <ErrorState message="Could not load make-up lessons." onRetry={() => q.refetch()} />;
  if (!q.data) return null;
  const { items, counts } = q.data;
  return (
    <section aria-label="Make-up lessons" className="space-y-3">
      <h2 className="text-lg font-medium">Make-up lessons</h2>
      <p className="text-xs text-muted">
        Every absence stays here until the learner attends a make-up · deadline 14 days.{" "}
        <span data-testid="makeup-counts">
          {counts.overdue} overdue · {counts.open} to arrange · {counts.booked} booked ·{" "}
          {counts.done} made up
        </span>
      </p>
      {items.length === 0 ? (
        <Card>
          <p className="text-sm">No missed lessons.</p>
        </Card>
      ) : (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id}>
              <MakeupCard viewer={viewer} item={i} teachers={teachers} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MakeupCard({
  viewer,
  item,
  teachers,
}: {
  viewer: string;
  item: MakeupItem;
  teachers: TeacherRef[];
}) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (run: () => Promise<MakeupResult>) => run(),
    onSuccess: () => refreshLearningState(qc),
  });
  const [mode, setMode] = useState<null | "book" | "open">(null);
  const [choice, setChoice] = useState("");
  const [when, setWhen] = useState("");
  const [teacherId, setTeacherId] = useState(teachers[0]?.id ?? "");
  const options = useQuery({
    queryKey: ["makeup-options", viewer, item.id],
    queryFn: () => makeup.listOptions(viewer, item.id),
    enabled: mode === "book",
  });
  const label = `${item.learnerName} · ${item.unitTitle}`;

  return (
    <Card className="space-y-2">
      <div data-makeup={item.id} className="flex flex-wrap items-baseline justify-between gap-2">
        <p>
          <span className="font-medium">{item.learnerName}</span>{" "}
          <span className="text-sm text-muted">· {item.className}</span>
          <br />
          <span className="text-sm">
            Missed {item.unitTitle} · {formatCenterDate(item.missedAt)} · due{" "}
            {formatCenterDate(item.dueAt)}
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
          {STATUS[item.status]}
        </span>
      </div>
      {item.missedMakeup ? (
        <p className="text-sm text-danger">Absent from the booked make-up too — arrange another.</p>
      ) : null}
      {item.booking ? (
        <p className="text-sm">
          <span className="text-muted">{item.status === "done" ? "Made up at" : "Booked:"}</span>{" "}
          {item.booking.kind === "join" ? `joins ${item.booking.className}` : "make-up session"} ·{" "}
          {formatCenterDateTime(item.booking.at)}
          {item.booking.teacherName ? ` · ${item.booking.teacherName}` : ""}
        </p>
      ) : null}
      {item.status !== "done" && !mode ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setMode("book")}>
            {item.status === "booked" ? "Change booking" : "Find a session"} · {label}
          </Button>
          {item.status === "booked" ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                setWhen(
                  isoToCenterLocal(new Date(Date.now() + 2 * 86_400_000).toISOString()).slice(
                    0,
                    11,
                  ) + "17:00",
                );
                setMode("open");
              }}
            >
              Open a make-up session · {label}
            </Button>
          )}
        </div>
      ) : null}
      {mode === "book" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate(() => makeup.book(viewer, item.id, choice), {
              onSuccess: (r) => r.ok && setMode(null),
            });
          }}
        >
          {options.isLoading ? (
            <Spinner label="Finding sessions" />
          ) : options.data && options.data.length > 0 ? (
            <label className="text-sm">
              <span className="block text-muted">Same unit, still ahead</span>
              <select
                aria-label={`Make-up session for ${label}`}
                className="mt-1 rounded-ogc border border-border bg-surface p-1.5"
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
              >
                <option value="">Choose…</option>
                {options.data.map((o) => (
                  <option key={o.sessionId} value={o.sessionId}>
                    {o.kind === "join" ? `Join ${o.className}` : "Make-up session"} ·{" "}
                    {formatCenterDateTime(o.at)}
                    {o.teacherName ? ` · ${o.teacherName}` : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-sm text-muted">
              No other session teaches {item.unitTitle} — open a make-up session.
            </p>
          )}
          <Button type="submit" disabled={!choice || act.isPending}>
            Book
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode(null)}>
            Back
          </Button>
        </form>
      ) : null}
      {mode === "open" ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.mutate(
              () =>
                makeup.openMakeupSession(viewer, item.id, centerLocalToIso(when) ?? "", teacherId),
              {
                onSuccess: (r) => r.ok && setMode(null),
              },
            );
          }}
        >
          <label className="text-sm">
            <span className="block text-muted">When (center time)</span>
            <input
              type="datetime-local"
              aria-label={`Make-up time for ${label}`}
              className="mt-1 rounded-ogc border border-border bg-surface p-1.5"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted">Teacher</span>
            <select
              aria-label={`Make-up teacher for ${label}`}
              className="mt-1 rounded-ogc border border-border bg-surface p-1.5"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={!when || act.isPending}>
            Open and book everyone missing {item.unitTitle}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode(null)}>
            Back
          </Button>
        </form>
      ) : null}
      {act.data && !act.data.ok ? (
        <p role="alert" className="text-sm text-danger">
          {REFUSAL[act.data.reason] ?? "Could not arrange the make-up."}
        </p>
      ) : null}
    </Card>
  );
}
