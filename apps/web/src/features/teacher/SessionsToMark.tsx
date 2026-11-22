/*
 * P2 · Sessions that have started but are not marked yet, across the teacher's own classes.
 * One link per session to the take-attendance page.
 */
import { Link } from "react-router-dom";
import { Card, ErrorState, Spinner } from "../../ui";
import { formatCenterDateTime } from "../../lib/centerTime";
import { useSessionsToMark } from "./queries";

export function SessionsToMark() {
  const q = useSessionsToMark();

  return (
    <section aria-label="Attendance to take">
      <h2 className="mb-3 text-lg font-medium">
        Attendance to take{q.data && q.data.length > 0 ? ` (${q.data.length})` : ""}
      </h2>
      {q.isLoading ? (
        <Spinner label="Loading sessions to mark" />
      ) : q.isError ? (
        <ErrorState message="Could not load sessions to mark." onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-sm text-muted">Every session that has started is marked.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {s.title}{" "}
                  <span className="text-sm text-muted">· {formatCenterDateTime(s.at)}</span>
                </span>
                <Link
                  to={`/app/teaching/classes/${s.classId}/sessions/${s.id}`}
                  className="rounded-ogc border border-border px-3 py-1.5 text-sm text-brand hover:bg-surface"
                >
                  Take attendance · {s.title}
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
