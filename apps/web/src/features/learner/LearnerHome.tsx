import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, ProgressRing, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useLearnerDashboard } from "./queries";

export function LearnerHome() {
  const { session } = useSession();
  const q = useLearnerDashboard(session?.personaId ?? "");

  if (q.isLoading) return <Spinner label="Loading your learning" />;
  if (q.isError) return <ErrorState message="Could not load your learning." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="No learner profile for this persona" hint="Sign in as the learner demo persona." />;

  const d = q.data;
  // Overall progress uses equal course weighting (per Slice-5 decision: equal_course_weight).
  const overallPct =
    d.enrolled.length > 0
      ? Math.round(d.enrolled.reduce((sum, e) => sum + e.progressPct, 0) / d.enrolled.length)
      : 0;
  const inProgress = d.enrolled.filter((e) => e.state === "in_progress").length;

  return (
    <section className="space-y-8">
      <PageHeader title="My Learning" subtitle={`${d.learnerName} · synthetic demo`} />

      {d.enrolled.length > 0 ? (
        <Card className="flex items-center gap-5">
          <ProgressRing pct={overallPct} label="Overall learning progress" />
          <div>
            <p className="font-medium">Overall progress</p>
            <p className="mt-1 text-sm text-muted">
              {d.enrolled.length} course{d.enrolled.length === 1 ? "" : "s"} · {inProgress} in progress ·
              equal-weight average
            </p>
          </div>
        </Card>
      ) : null}

      <div>
        <h2 className="mb-3 text-lg font-medium">Enrolled courses</h2>
        {d.enrolled.length === 0 ? (
          <EmptyState title="No enrolled courses" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {d.enrolled.map((e) => (
              <li key={e.course.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{e.course.title}</h3>
                      <p className="text-sm text-muted">
                        {e.course.level} · {e.state.replace("_", " ")}
                      </p>
                    </div>
                    <span className="text-sm text-muted">{e.progressPct}%</span>
                  </div>
                  <ProgressBar pct={e.progressPct} className="mt-2" />
                  <div className="mt-3 flex gap-2">
                    <Link to={`/app/learning/courses/${e.course.id}`}>
                      <Button variant="ghost">Resume learning</Button>
                    </Link>
                    <Link to={`/app/catalog/${e.course.id}`}>
                      <Button variant="ghost">Course details</Button>
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Upcoming lessons</h2>
        {d.upcoming.length === 0 ? (
          <EmptyState title="Nothing scheduled" />
        ) : (
          <ul className="space-y-2">
            {d.upcoming.map((l) => (
              <li key={l.id}>
                <Card className="flex items-center justify-between">
                  <span>{l.title}</span>
                  <span className="text-sm text-muted">
                    {l.scheduledAt ? new Date(l.scheduledAt).toLocaleString() : "Unscheduled"} · {l.durationMin}m
                  </span>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
