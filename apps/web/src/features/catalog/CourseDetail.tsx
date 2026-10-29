import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useCourse } from "./queries";
import { useEnroll, useEnrollmentState } from "../enrollment/queries";

export function CourseDetail() {
  const { courseId = "" } = useParams();
  const { session } = useSession();
  const navigate = useNavigate();
  const personaId = session?.personaId ?? "";
  const q = useCourse(courseId);
  const stateQ = useEnrollmentState(personaId, courseId);
  const enroll = useEnroll(personaId);

  if (q.isLoading) return <Spinner label="Loading course" />;
  if (q.isError) return <ErrorState message="Could not load course." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Course not found" />;

  const c = q.data;
  const state = stateQ.data ?? "not_enrolled";
  const isEnrolled = state !== "not_enrolled";
  // Only learner personas can enroll themselves in this synthetic flow.
  const canEnroll = session?.role === "learner";

  return (
    <section className="space-y-6">
      <PageHeader title={c.title} subtitle={`${c.code} · ${c.level}`} />
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
      <Link to="/app/catalog" className="inline-block text-sm text-brand">
        ← Back to catalog
      </Link>
    </section>
  );
}
