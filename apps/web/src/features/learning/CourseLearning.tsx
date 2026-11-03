import { Link, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useCourse } from "../catalog/queries";
import { useActivities, useActivityAttempts, useCompleteActivity, useCourseProgress } from "./queries";

export function CourseLearning() {
  const { session } = useSession();
  const personaId = session?.personaId ?? "";
  const { courseId = "" } = useParams();
  const course = useCourse(session?.orgId ?? "", courseId);
  const acts = useActivities(personaId, courseId);
  const progress = useCourseProgress(personaId, courseId);
  const attempts = useActivityAttempts(personaId, (acts.data ?? []).map((a) => a.id));
  const complete = useCompleteActivity(personaId, courseId);

  if (course.isLoading || acts.isLoading) return <Spinner label="Loading course" />;
  if (course.isError) return <ErrorState message="Could not load the course." onRetry={() => course.refetch()} />;
  if (!course.data) return <EmptyState title="Course not found" />;

  const list = acts.data ?? [];
  const attemptMap = attempts.data ?? {};
  const snap = progress.data;

  return (
    <section className="space-y-6">
      <PageHeader title={course.data.title} subtitle="Learning activities · synthetic, in-memory" />

      {snap ? (
        <Card className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Course progress</span>
            <span className="text-muted">
              {snap.completedActivities}/{snap.totalActivities} done · {snap.progressPct}%
            </span>
          </div>
          <ProgressBar pct={snap.progressPct} label={`${course.data.title} progress`} />
          <p className="text-xs text-muted">{snap.assessedCount} assessed activity(ies).</p>
        </Card>
      ) : null}

      {list.length === 0 ? (
        <EmptyState title="No activities for this course" />
      ) : (
        <ul className="space-y-2">
          {list.map((a) => {
            const att = attemptMap[a.id];
            const done = att?.state === "completed";
            return (
              <li key={a.id}>
                <Card className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{a.title}</p>
                    <p className="text-xs uppercase tracking-wide text-muted">
                      {a.kind}
                      {a.assessed ? " · assessed" : ""}
                      {done && att?.score !== null && att?.score !== undefined
                        ? ` · score ${att.score}`
                        : ""}
                    </p>
                  </div>
                  {done ? (
                    <span className="text-sm text-brand">Completed</span>
                  ) : (
                    <Button
                      onClick={() => complete.mutate(a.id)}
                      disabled={complete.isPending}
                      aria-label={`Complete ${a.title}`}
                    >
                      {complete.isPending ? "Saving…" : "Mark complete"}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {complete.data && !complete.data.completed ? (
        <p role="alert" className="text-sm text-danger">
          {complete.data.reason === "already_completed"
            ? "That activity is already complete."
            : complete.data.reason === "not_enrolled"
              ? "Enroll in this course before completing activities."
              : "Could not complete that activity."}
        </p>
      ) : null}

      <Link to="/app/learning" className="inline-block text-sm text-brand">
        ← Back to My Learning
      </Link>
    </section>
  );
}
