import { Link, useParams } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useCourse } from "./queries";
import { useLearnerDashboard } from "../learner/queries";

export function CourseDetail() {
  const { courseId = "" } = useParams();
  const { session } = useSession();
  const q = useCourse(courseId);
  const learner = useLearnerDashboard(session?.personaId ?? "");

  if (q.isLoading) return <Spinner label="Loading course" />;
  if (q.isError) return <ErrorState message="Could not load course." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Course not found" />;

  const c = q.data;
  const enrollment = learner.data?.enrolled.find((e) => e.course.id === c.id);
  const state = enrollment?.state ?? "not_enrolled";

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
            <dd className="mt-1">
              {state.replace("_", " ")}
              {enrollment ? ` · ${enrollment.progressPct}%` : ""}
            </dd>
          </div>
        </dl>
      </Card>
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
