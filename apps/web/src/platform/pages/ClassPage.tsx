// One class for its teacher (real API): sessions and the attendance summary (marked sessions only).
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { formatCenterDateTime } from "../../lib/centerTime";
import { platformApi } from "../client";
import { useSignedIn } from "../App";

const STATUS: Record<string, string> = {
  upcoming: "upcoming",
  to_mark: "to mark",
  marked: "marked",
  cancelled: "cancelled",
};

export function ClassPage() {
  const session = useSignedIn();
  const id = useParams().id ?? "";
  const sessions = useQuery({
    queryKey: ["class-sessions", id],
    queryFn: () => platformApi.classSessions(session, id),
  });
  const summary = useQuery({
    queryKey: ["class-summary", id],
    queryFn: () => platformApi.classSummary(session, id),
  });
  if (sessions.isLoading || summary.isLoading) return <Spinner label="Loading class" />;
  if (sessions.isError || summary.isError)
    return <ErrorState message="This class is not available to you." />;
  return (
    <section>
      <PageHeader title="Class" subtitle="Attendance summary counts marked sessions only." />
      <Card className="mb-4">
        <h2 className="mb-2 font-medium">Sessions</h2>
        <ul>
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-2 border-t border-border py-2">
              {s.status === "to_mark" || s.status === "marked" ? (
                <Link className="underline" to={`/sessions/${encodeURIComponent(s.id)}`}>
                  {formatCenterDateTime(s.at)}
                </Link>
              ) : (
                <span>{formatCenterDateTime(s.at)}</span>
              )}
              <span className="text-sm text-muted">{s.title}</span>
              <Badge>{STATUS[s.status] ?? s.status}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">Attendance summary</h2>
        {summary.data?.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th>Learner</th>
                <th>Present</th>
                <th>Late</th>
                <th>Absent</th>
                <th>Attended</th>
                <th>Absent streak</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.map((r) => (
                <tr key={r.learnerId} className="border-t border-border">
                  <td>{r.displayName}</td>
                  <td>{r.present}</td>
                  <td>{r.late}</td>
                  <td>{r.absent}</td>
                  <td>{r.attendedPct === null ? "—" : `${r.attendedPct}%`}</td>
                  <td>{r.absentStreak}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No learners." />
        )}
      </Card>
    </section>
  );
}
