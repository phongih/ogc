import { Link, useParams } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useClassRoster } from "./queries";
import { useClassProgress } from "../learning/queries";

export function ClassDetail() {
  const { classId = "" } = useParams();
  const { session } = useSession();
  const q = useClassRoster(classId);
  const progress = useClassProgress(session?.personaId ?? "", (q.data ?? []).map((r) => r.learnerId));

  return (
    <section className="space-y-6">
      <PageHeader title="Learner overview" subtitle="Class roster · synthetic demo" />
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
