import { useViewer } from "../../app/iiosGate";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useCourse, useCourses } from "./queries";
import { useEnroll, useEnrollmentState } from "../enrollment/queries";

export function CourseDetail() {
  const { courseId = "" } = useParams();
  const { session } = useSession();
  const viewer = useViewer();
  const navigate = useNavigate();
  const q = useCourse(session?.orgId ?? "", courseId);
  const stateQ = useEnrollmentState(viewer, courseId);
  const enroll = useEnroll(viewer);
  const catalog = useCourses(session?.orgId ?? "");

  if (q.isLoading) return <Spinner label="Loading course" />;
  if (q.isError) return <ErrorState message="Could not load course." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Course not found" />;

  const c = q.data;
  const state = stateQ.data ?? "not_enrolled";
  const isEnrolled = state !== "not_enrolled";
  // Only learner personas can enroll themselves in this synthetic flow.
  const canEnroll = session?.role === "learner";
  const related = (catalog.data?.pages ?? [])
    .flatMap((p) => p.items)
    .filter((x) => x.id !== c.id)
    .slice(0, 3);

  return (
    <section className="space-y-6">
      <PageHeader title={c.title} subtitle={c.code} />
      <div className="flex flex-wrap gap-2">
        <Badge>{c.level}</Badge>
        <Badge>{c.format.replace("_", " ")}</Badge>
        <Badge>{c.durationWeeks} weeks</Badge>
      </div>
      <Card>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Format</dt>
            <dd className="mt-1">{c.format.replace("_", " ")}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Duration</dt>
            <dd className="mt-1">{c.durationWeeks} weeks</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Enrollment</dt>
            <dd className="mt-1">{state.replace("_", " ")}</dd>
          </div>
        </dl>
      </Card>

      {canEnroll ? (
        <Card className="space-y-3">
          {isEnrolled ? (
            <>
              <p className="text-sm text-muted">You are enrolled in this course.</p>
              <Button onClick={() => navigate("/app/learning")}>Resume learning</Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">Enroll to add this course to My Learning.</p>
              <Button
                onClick={() => enroll.mutate(c.id)}
                disabled={enroll.isPending}
                aria-label={`Enroll in ${c.title}`}
              >
                {enroll.isPending ? "Enrolling…" : "Enroll"}
              </Button>
              {enroll.data && !enroll.data.enrolled ? (
                <p role="alert" className="text-sm text-danger">
                  {enroll.data.reason === "already_enrolled"
                    ? "You are already enrolled in this course."
                    : "Could not enroll in this course."}
                </p>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      <div>
        <h2 className="mb-2 text-lg font-medium">Learning objectives</h2>
        <ul className="list-inside list-disc space-y-1 text-sm">
          {c.objectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </div>
      {related.length > 0 ? (
        <div>
          <h2 className="mb-2 text-lg font-medium">Related courses</h2>
          <ul className="space-y-1 text-sm">
            {related.map((rc) => (
              <li key={rc.id}>
                <Link to={`/app/catalog/${rc.id}`} className="text-brand hover:underline">
                  {rc.title}
                </Link>
                <span className="text-muted"> · {rc.level}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Link to="/app/catalog" className="inline-block text-sm text-brand">
        ← Back to catalog
      </Link>
    </section>
  );
}
