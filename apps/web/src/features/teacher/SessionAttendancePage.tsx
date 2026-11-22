/*
 * P2 · Take attendance for one session (owning teacher). Present / Late / Absent for every
 * learner on the roster; Save is enabled only when everyone is marked. A session that has not
 * started cannot be marked. Saving again replaces the earlier marks (owner decision 21/11).
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { AttendanceMark } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { formatCenterDateTime } from "../../lib/centerTime";
import { useRecordAttendance, useSessionAttendance } from "./queries";

const MARKS: { value: AttendanceMark; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
];

const REASON_TEXT: Record<string, string> = {
  not_found: "This session is not one of your classes.",
  not_started: "This session has not started yet.",
  incomplete: "Mark every learner before saving.",
  not_on_roster: "A learner is not on this class roster.",
  cancelled: "This session was cancelled.",
};

export function SessionAttendancePage() {
  const { classId = "", sessionId = "" } = useParams();
  const q = useSessionAttendance(sessionId);
  const save = useRecordAttendance(sessionId);
  const [draft, setDraft] = useState<Record<string, AttendanceMark>>({});
  const [saved, setSaved] = useState(false);

  // Start from what is already recorded (editing a marked session) — once per session.
  const data = q.data;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (data && loadedFor !== data.session.id) {
    setLoadedFor(data.session.id);
    setDraft(
      Object.fromEntries(data.rows.filter((r) => r.mark).map((r) => [r.learnerId, r.mark!])),
    );
  }

  const back = (
    <Link to={`/app/teaching/classes/${classId}`} className="inline-block text-sm text-brand">
      ← Back to the class
    </Link>
  );

  if (q.isLoading) return <Spinner label="Loading attendance" />;
  if (q.isError)
    return <ErrorState message="Could not load this session." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <section className="space-y-4">
        <EmptyState
          title="Session not available"
          hint="Only the class's own teacher can take attendance."
        />
        {back}
      </section>
    );

  const { session: s, rows, className } = q.data;
  const upcoming = s.status === "upcoming";
  if (s.status === "cancelled")
    return (
      <section className="space-y-4">
        <PageHeader
          title={`Attendance · ${s.title}`}
          subtitle={`${className} · ${formatCenterDateTime(s.at)}`}
        />
        <Card>
          <p className="text-sm">
            This session was cancelled and moved — mark the replacement session instead.
          </p>
        </Card>
        {back}
      </section>
    );
  const complete = rows.length > 0 && rows.every((r) => draft[r.learnerId]);

  return (
    <section className="space-y-6">
      <PageHeader
        title={`Attendance · ${s.title}`}
        subtitle={`${s.kind === "makeup" ? "Make-up session · " : ""}${className} · ${formatCenterDateTime(s.at)}`}
      />
      {upcoming ? (
        <Card>
          <p role="status" className="text-sm">
            This session has not started yet — attendance opens when it starts.
          </p>
        </Card>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            save.mutate(
              { marks: rows.map((r) => ({ learnerId: r.learnerId, mark: draft[r.learnerId]! })) },
              { onSuccess: (res) => setSaved(res.ok) },
            );
          }}
        >
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm text-muted">
                {s.status === "marked"
                  ? "Marked — saving again replaces these marks."
                  : "Not marked yet."}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setDraft(Object.fromEntries(rows.map((r) => [r.learnerId, "present"])))
                }
              >
                Mark all present
              </Button>
            </div>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li
                  key={r.learnerId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <span>
                    {r.displayName}
                    {r.makeupFor ? (
                      <span className="ml-2 rounded-full border border-brand px-2 py-0.5 text-xs text-brand">
                        Make-up · from {r.makeupFor}
                      </span>
                    ) : null}
                  </span>
                  <fieldset className="flex gap-3" aria-label={`Attendance for ${r.displayName}`}>
                    {MARKS.map((m) => (
                      <label key={m.value} className="flex items-center gap-1 text-sm">
                        <input
                          type="radio"
                          name={`mark-${r.learnerId}`}
                          value={m.value}
                          checked={draft[r.learnerId] === m.value}
                          onChange={() => {
                            setSaved(false);
                            setDraft((d) => ({ ...d, [r.learnerId]: m.value }));
                          }}
                        />
                        {m.label}
                      </label>
                    ))}
                  </fieldset>
                </li>
              ))}
            </ul>
          </Card>
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!complete || save.isPending}>
              Save attendance
            </Button>
            {!complete ? (
              <span className="text-sm text-muted">Mark every learner to save.</span>
            ) : null}
          </div>
          {saved ? (
            <p role="status" className="text-sm">
              Attendance saved.
            </p>
          ) : null}
          {save.data && !save.data.ok ? (
            <p role="alert" className="text-sm text-danger">
              {REASON_TEXT[save.data.reason] ?? "Could not save attendance."}
            </p>
          ) : null}
        </form>
      )}
      {back}
    </section>
  );
}
