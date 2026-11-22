import { useViewer } from "../../app/iiosGate";
import { Link, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { speakingFor } from "../../fixtures/speaking";
import { practiceFor } from "../../fixtures/practice";
import { useCourse } from "../catalog/queries";
import { useLearningPath } from "../learner/queries";
import { activities as allActivities } from "../../fixtures/activities";
import {
  useActivities,
  useActivityAttempts,
  useCompleteActivity,
  useCourseProgress,
} from "./queries";

export function CourseLearning() {
  const { session } = useSession();
  const viewer = useViewer();
  const { courseId = "" } = useParams();
  const course = useCourse(session?.orgId ?? "", courseId);
  const acts = useActivities(viewer, courseId);
  const progress = useCourseProgress(viewer, courseId);
  const attempts = useActivityAttempts(
    viewer,
    (acts.data ?? []).map((a) => a.id),
  );
  const complete = useCompleteActivity(viewer, courseId);
  // Hard prerequisite gate: blocked steps of the learner's own path cannot be started here.
  const path = useLearningPath(viewer);
  const blockedBy = new Map(
    (path.data?.steps ?? [])
      .filter((s) => s.state === "blocked")
      .map((s) => [s.activityId, s.blockedBy]),
  );
  const titleOf = (id: string) =>
    allActivities.find((x) => x.id === id)?.title ?? "an earlier activity";

  if (course.isLoading || acts.isLoading) return <Spinner label="Loading course" />;
  if (course.isError)
    return <ErrorState message="Could not load the course." onRetry={() => course.refetch()} />;
  if (!course.data) return <EmptyState title="Course not found" />;

  const list = acts.data ?? [];
  const attemptMap = attempts.data ?? {};
  const snap = progress.data;
  // Per-activity pending feedback: only the activity currently being completed shows a
  // "Completing…" state, instead of disabling/relabelling every row.
  const pendingId = complete.isPending ? (complete.variables as string | undefined) : undefined;

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
                  ) : pendingId === a.id ? (
                    <span className="text-sm text-muted" aria-live="polite">
                      Completing…
                    </span>
                  ) : blockedBy.has(a.id) ? (
                    <span className="text-sm text-muted" data-testid={`locked-${a.id}`}>
                      <span aria-hidden="true">🔒 </span>
                      Finish{" "}
                      {(blockedBy.get(a.id) ?? [])
                        .map((id) => `“${titleOf(id)}”`)
                        .join(" and ")}{" "}
                      first
                    </span>
                  ) : practiceFor(a.id) ? (
                    <Link to={`/app/learning/practice/${a.id}`} className="inline-block">
                      <Button variant="ghost">Practice now</Button>
                    </Link>
                  ) : speakingFor(a.id) ? (
                    <Link to={`/app/learning/speaking/${a.id}`} className="inline-block">
                      <Button variant="ghost">Open speaking studio</Button>
                    </Link>
                  ) : (
                    <Button
                      onClick={() => complete.mutate(a.id)}
                      disabled={complete.isPending}
                      aria-label={`Complete ${a.title}`}
                    >
                      Mark complete
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
      {complete.data?.completed ? (
        <p role="status" className="text-sm text-brand">
          Activity marked complete.
        </p>
      ) : null}

      <Link to="/app/learning" className="inline-block text-sm text-brand">
        ← Back to My Learning
      </Link>
    </section>
  );
}
