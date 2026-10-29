import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useLearnerDashboard } from "./queries";

function ProgressBar({ pct }: { pct: number }) {
  return (
    <div
      className="mt-2 h-2 w-full overflow-hidden rounded-full bg-border"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Progress ${pct}%`}
    >
      <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function LearnerHome() {
  const { session } = useSession();
  const q = useLearnerDashboard(session?.personaId ?? "");

  if (q.isLoading) return <Spinner label="Loading your learning" />;
  if (q.isError) return <ErrorState message="Could not load your learning." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="No learner profile for this persona" hint="Sign in as the learner demo persona." />;

  const d = q.data;
  return (
    <section className="space-y-8">
      <PageHeader title="My Learning" subtitle={`${d.learnerName} · synthetic demo`} />

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
                  <ProgressBar pct={e.progressPct} />
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
