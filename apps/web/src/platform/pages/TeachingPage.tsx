// Teacher home (real API): sessions waiting for attendance, then my classes.
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { formatCenterDateTime } from "../../lib/centerTime";
import { platformApi } from "../client";
import { useSignedIn } from "../App";

export function TeachingPage() {
  const session = useSignedIn();
  const toMark = useQuery({ queryKey: ["to-mark"], queryFn: () => platformApi.toMark(session) });
  const classes = useQuery({
    queryKey: ["my-classes"],
    queryFn: () => platformApi.myClasses(session),
  });
  if (toMark.isLoading || classes.isLoading) return <Spinner label="Loading" />;
  if (toMark.isError || classes.isError)
    return (
      <ErrorState
        message="Could not load your classes."
        onRetry={() => {
          void toMark.refetch();
          void classes.refetch();
        }}
      />
    );
  return (
    <section>
      <PageHeader title="Teaching" subtitle="Times are center time (Asia/Ho_Chi_Minh)." />
      <Card className="mb-4">
        <h2 className="mb-2 font-medium">To mark</h2>
        {toMark.data?.length ? (
          <ul>
            {toMark.data.map((s) => (
              <li key={s.id} className="border-t border-border py-2">
                <Link className="underline" to={`/sessions/${encodeURIComponent(s.id)}`}>
                  {s.title} · {formatCenterDateTime(s.at)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing to mark." />
        )}
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">My classes</h2>
        {classes.data?.length ? (
          <ul>
            {classes.data.map((c) => (
              <li key={c.classId} className="border-t border-border py-2">
                <Link className="underline" to={`/classes/${encodeURIComponent(c.classId)}`}>
                  {c.className}
                </Link>{" "}
                <span className="text-sm text-muted">
                  {c.centerName} · {c.learnerCount} learners
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No classes." />
        )}
      </Card>
    </section>
  );
}
