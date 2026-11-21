import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressRing, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useClassAttendance, useClassRoster, useClassSessions } from "./queries";
import { formatCenterDateTime } from "../../lib/centerTime";
import { useClassProgress } from "../learning/queries";
import { LearnerIntelligencePanel } from "./LearnerIntelligencePanel";

export function ClassDetail() {
  const { classId = "" } = useParams();
  const { session } = useSession();
  const q = useClassRoster(classId);
  const [openLearner, setOpenLearner] = useState<{ id: string; name: string } | null>(null);
  const progress = useClassProgress(session?.personaId ?? "", (q.data ?? []).map((r) => r.learnerId));
  const attendance = useClassAttendance(session?.personaId ?? "", classId);
  const sessions = useClassSessions(session?.personaId ?? "", classId);

  // Class-level overall = equal-weight mean across the learners the viewer is authorized to
  // see (fail-closed entries resolve to null and are excluded, not counted as zero).
  const authorizedVals = Object.values(progress.data ?? {}).filter((v): v is number => typeof v === "number");
  const classPct = authorizedVals.length
    ? Math.round(authorizedVals.reduce((a, b) => a + b, 0) / authorizedVals.length)
    : 0;

  return (
    <section className="space-y-6">
      <PageHeader title="Learner overview" subtitle="Class roster · synthetic demo" />
      {q.data && q.data.length > 0 ? (
        <Card className="flex items-center gap-4">
          <ProgressRing pct={classPct} label="Class progress" size={64} />
          <div>
            <p className="font-medium">Class progress</p>
            <p className="text-xs text-muted">
              {authorizedVals.length} of {q.data.length} learners · equal-weight average
            </p>
          </div>
        </Card>
      ) : null}
      {q.isLoading ? (
        <Spinner label="Loading roster" />
      ) : q.isError ? (
        <ErrorState message="Could not load the roster." onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState title="No learners in this class" />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="pb-2 font-medium">Learner</th>
                <th className="pb-2 font-medium">Progress (activities)</th>
                <th className="pb-2 font-medium">Intelligence</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((r) => {
                const overall = progress.data?.[r.learnerId];
                return (
                  <tr key={r.learnerId} className="border-t border-border">
                    <td className="py-2">{r.displayName}</td>
                    <td className="py-2">
                      {overall === null
                        ? "—"
                        : overall === undefined
                          ? "…"
                          : `${overall}%`}
                    </td>
                    <td className="py-2">
                      <Button
                        variant="ghost"
                        aria-label={`View intelligence for ${r.displayName}`}
                        onClick={() =>
                          setOpenLearner((cur) =>
                            cur?.id === r.learnerId ? null : { id: r.learnerId, name: r.displayName },
                          )
                        }
                      >
                        {openLearner?.id === r.learnerId ? "Hide" : "View"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {openLearner ? (
        <section aria-label="Learner learning intelligence">
          <h2 className="mb-2 text-lg font-medium">Learning intelligence · {openLearner.name}</h2>
          <LearnerIntelligencePanel
            viewerPersonaId={session?.personaId ?? ""}
            learnerId={openLearner.id}
            learnerName={openLearner.name}
          />
        </section>
      ) : null}
      <section aria-label="Attendance" className="space-y-3">
        <h2 className="text-lg font-medium">Attendance</h2>
        <p className="text-xs text-muted">
          From marked sessions only. Attended = present + late.
        </p>
        {attendance.data && attendance.data.length > 0 ? (
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-2 font-medium">Learner</th>
                  <th className="pb-2 font-medium">Present</th>
                  <th className="pb-2 font-medium">Late</th>
                  <th className="pb-2 font-medium">Absent</th>
                  <th className="pb-2 font-medium">Attended</th>
                </tr>
              </thead>
              <tbody>
                {attendance.data.map((a) => (
                  <tr key={a.learnerId} className="border-t border-border">
                    <td className="py-2">{a.displayName}</td>
                    <td className="py-2">{a.present}</td>
                    <td className="py-2">{a.late}</td>
                    <td className="py-2">
                      {a.absent}
                      {a.absentStreak >= 2 ? (
                        <span className="ml-2 text-xs text-danger">last {a.absentStreak} in a row</span>
                      ) : null}
                    </td>
                    <td className="py-2">
                      {a.attendedPct === null ? "—" : `${a.attendedPct}% of ${a.marked}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
        {sessions.data && sessions.data.length > 0 ? (
          <ul className="space-y-2" aria-label="Sessions">
            {sessions.data.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    {s.title}{" "}
                    <span className="text-sm text-muted">· {formatCenterDateTime(s.at)}</span>
                  </span>
                  {s.status === "upcoming" ? (
                    <span className="text-sm text-muted">Upcoming</span>
                  ) : (
                    <Link
                      to={`/app/teaching/classes/${classId}/sessions/${s.id}`}
                      className="rounded-ogc border border-border px-3 py-1.5 text-sm text-brand hover:bg-surface"
                    >
                      {s.status === "to_mark" ? "Take attendance" : "Edit attendance"} · {s.title}
                    </Link>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section id="plan" aria-label="Lesson planning">
        <h2 className="mb-2 text-lg font-medium">Lesson planning</h2>
        <Link
          to={`/app/teaching/classes/${classId}/plan`}
          className="inline-block rounded-ogc border border-border px-4 py-2 text-sm text-brand hover:bg-surface"
        >
          Open lesson plan editor
        </Link>
      </section>
      <Link to="/app/teaching" className="inline-block text-sm text-brand">
        ← Back to teaching
      </Link>
    </section>
  );
}
