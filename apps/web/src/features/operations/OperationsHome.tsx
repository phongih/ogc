/*
 * P2 · Center operations (staff). Owner decisions 21/11: staff manage the class schedule and the
 * teacher assignment. Cancelling a session REQUIRES a replacement time for the whole class, so no
 * learner loses the lesson. Started or marked sessions are history: no move, no cancel.
 * All times are CENTER time (Asia/Ho_Chi_Minh), whatever the staff member's device says.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClassSchedule, ScheduleResult, ScheduledSession, TeacherRef } from "@ogc/contracts";
import { schedule } from "../../lib/api";
import { useSession } from "../../app/session";
import { refreshLearningState } from "../../lib/invalidate";
import { centerLocalToIso, formatCenterDateTime, isoToCenterLocal } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { MakeupBoard } from "./MakeupBoard";

const REFUSAL: Record<string, string> = {
  not_found: "That class or session is not in your center.",
  not_staff: "Only center staff can change the schedule.",
  in_past: "Pick a time in the future (center time).",
  already_started: "That session has started or been marked — it is history now.",
  cancelled: "That session is already cancelled.",
  unknown_teacher: "Unknown teacher.",
  same_teacher: "That teacher already teaches this class.",
};

const DAY_MS = 86_400_000;

function useOpsAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<ScheduleResult>) => run(),
    onSuccess: () => refreshLearningState(qc),
  });
}

export function OperationsHome() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  const q = useQuery({
    queryKey: ["ops-overview", viewer],
    queryFn: () => schedule.getOverview(viewer),
    enabled: viewer.length > 0,
  });

  if (q.isLoading) return <Spinner label="Loading center operations" />;
  if (q.isError)
    return <ErrorState message="Could not load center operations." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Center operations are for center staff" />;

  return (
    <section className="space-y-8">
      <PageHeader
        title="Center operations"
        subtitle="Schedule and teacher assignment · center time · synthetic demo"
      />
      <Link
        to="/app/operations/centers/new"
        className="inline-block rounded-ogc border border-border px-4 py-2 text-sm text-brand hover:bg-surface"
      >
        + Set up a new center
      </Link>
      <MakeupBoard viewer={viewer} teachers={q.data.teachers} />
      {q.data.classes.map((c) => (
        <ClassCard key={c.classId} viewer={viewer} cls={c} teachers={q.data!.teachers} />
      ))}
    </section>
  );
}

function ClassCard({
  viewer,
  cls,
  teachers,
}: {
  viewer: string;
  cls: ClassSchedule;
  teachers: TeacherRef[];
}) {
  const act = useOpsAction();
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const now = Date.now();
  // History older than the latest marked session is noise here: show what staff can still act on,
  // plus the most recent marked session for context.
  const lastMarked = [...cls.sessions].reverse().find((s) => s.marked);
  const shown = cls.sessions.filter((s) => s === lastMarked || !s.marked);

  return (
    <section aria-label={cls.className} className="space-y-3">
      <h2 className="text-lg font-medium">{cls.className}</h2>
      <Card className="space-y-4">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Class teacher</span>
          <select
            aria-label={`Class teacher for ${cls.className}`}
            className="rounded-ogc border border-border bg-surface p-1.5"
            value={cls.teacher?.id ?? ""}
            onChange={(e) => {
              const teacherId = e.target.value; // read now, before the controlled re-render
              act.mutate(() => schedule.assignTeacher(viewer, cls.classId, teacherId));
            }}
          >
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">· {cls.learnerCount} learners</span>
        </label>

        <ul className="divide-y divide-border" aria-label={`Sessions of ${cls.className}`}>
          {shown.map((s) => (
            <SessionRow key={s.id} viewer={viewer} s={s} cls={cls} teachers={teachers} now={now} />
          ))}
        </ul>

        <form
          className="flex flex-wrap items-end gap-2 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            const iso = centerLocalToIso(at);
            act.mutate(() => schedule.addSession(viewer, cls.classId, title, iso ?? ""), {
              onSuccess: (r) => r.ok && (setTitle(""), setAt("")),
            });
          }}
        >
          <label className="text-sm">
            <span className="block text-muted">Extra session title</span>
            <input
              className="mt-1 rounded-ogc border border-border bg-surface p-1.5"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Review before test"
            />
          </label>
          <label className="text-sm">
            <span className="block text-muted">When (center time)</span>
            <input
              type="datetime-local"
              aria-label={`Extra session time for ${cls.className}`}
              className="mt-1 rounded-ogc border border-border bg-surface p-1.5"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <Button type="submit" variant="ghost" disabled={!at || act.isPending}>
            Add session
          </Button>
        </form>
        <ActionError result={act.data} />
      </Card>
    </section>
  );
}

function SessionRow({
  viewer,
  s,
  cls,
  teachers,
  now,
}: {
  viewer: string;
  s: ScheduledSession;
  cls: ClassSchedule;
  teachers: TeacherRef[];
  now: number;
}) {
  const act = useOpsAction();
  const [mode, setMode] = useState<null | "move" | "cancel">(null);
  const [when, setWhen] = useState("");
  const future = s.state === "scheduled" && !s.started && !s.marked;
  const canSub = s.state === "scheduled" && !s.marked;
  const status =
    s.state === "cancelled"
      ? `Cancelled → moved to ${cls.sessions.find((x) => x.id === s.replacedBy)?.at ? formatCenterDateTime(cls.sessions.find((x) => x.id === s.replacedBy)!.at) : "a new time"}`
      : s.marked
        ? "Marked"
        : s.started
          ? "Started · not marked yet"
          : s.replaces
            ? "Upcoming · replacement"
            : s.kind === "makeup"
              ? "Upcoming · make-up session"
              : "Upcoming";

  const open = (m: "move" | "cancel") => {
    setMode(m);
    setWhen(isoToCenterLocal(new Date(Math.max(Date.parse(s.at), now) + DAY_MS).toISOString()));
  };

  return (
    <li className="space-y-2 py-2" data-session={s.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={s.state === "cancelled" ? "text-muted line-through" : ""}>
          {s.kind === "makeup" ? "Make-up · " : ""}
          {s.title} <span className="text-sm text-muted">· {formatCenterDateTime(s.at)}</span>
        </span>
        <span className="text-xs text-muted">{status}</span>
      </div>
      {s.state === "scheduled" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {canSub ? (
            <label className="flex items-center gap-1">
              <span className="text-muted">Taught by</span>
              <select
                aria-label={`Teacher for ${s.title}`}
                className="rounded-ogc border border-border bg-surface p-1"
                value={s.substitute?.id ?? ""}
                onChange={(e) => {
                  // Read the value NOW: the controlled select re-renders before the mutation runs.
                  const teacherId = e.target.value || null;
                  act.mutate(() => schedule.setSubstitute(viewer, s.id, teacherId));
                }}
              >
                <option value="">{cls.teacher?.name ?? "Class teacher"} (class teacher)</option>
                {teachers
                  .filter((t) => t.id !== cls.teacher?.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} (substitute)
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          {future ? (
            <>
              <Button variant="ghost" onClick={() => open("move")}>
                Reschedule {s.title}
              </Button>
              <Button variant="ghost" onClick={() => open("cancel")}>
                Cancel {s.title}
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {mode ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const iso = centerLocalToIso(when) ?? "";
            act.mutate(
              () =>
                mode === "move"
                  ? schedule.reschedule(viewer, s.id, iso)
                  : schedule.cancelWithReplacement(viewer, s.id, iso),
              { onSuccess: (r) => r.ok && setMode(null) },
            );
          }}
        >
          <label className="text-sm">
            <span className="block text-muted">
              {mode === "move"
                ? "New time (center time)"
                : "Replacement time for the whole class (required)"}
            </span>
            <input
              type="datetime-local"
              aria-label={
                mode === "move" ? `New time for ${s.title}` : `Replacement time for ${s.title}`
              }
              className="mt-1 rounded-ogc border border-border bg-surface p-1.5"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              required
            />
          </label>
          <Button type="submit" disabled={!when || act.isPending}>
            {mode === "move" ? "Move session" : "Cancel and replace"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setMode(null)}>
            Back
          </Button>
        </form>
      ) : null}
      <ActionError result={act.data} />
    </li>
  );
}

function ActionError({ result }: { result: ScheduleResult | undefined }) {
  if (!result || result.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[result.reason] ?? "Could not change the schedule."}
    </p>
  );
}
