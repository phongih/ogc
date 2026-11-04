import { Link, useParams } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, ProgressRing, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useClassAttendance, useClassRoster } from "./queries";
import { useClassProgress } from "../learning/queries";

export function ClassDetail() {
  const { classId = "" } = useParams();
  const { session } = useSession();
  const q = useClassRoster(classId);
  const progress = useClassProgress(session?.personaId ?? "", (q.data ?? []).map((r) => r.learnerId));
  const attendance = useClassAttendance(session?.personaId ?? "", classId);

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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {attendance.data && attendance.data.length > 0 ? (
        <section aria-label="Attendance">
          <h2 className="mb-2 text-lg font-medium">Attendance</h2>
          <Card>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted">
                  <th className="pb-2 font-medium">Learner</th>
                  <th className="pb-2 font-medium">Present</th>
                  <th className="pb-2 font-medium">Absent</th>
                  <th className="pb-2 font-medium">Late</th>
                  <th className="pb-2 font-medium">Rate</th>
                </tr>
              </thead>
              <tbody>
                {attendance.data.map((a) => (
                  <tr key={a.learnerId} className="border-t border-border">
                    <td className="py-2">{a.displayName}</td>
                    <td className="py-2">{a.present}</td>
                    <td className="py-2">{a.absent}</td>
                    <td className="py-2">{a.late}</td>
                    <td className="py-2">{a.rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}

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
