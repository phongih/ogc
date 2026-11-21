import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { SpeakingReviewQueue } from "./SpeakingReviewQueue";
import { formatCenterDate, formatCenterDateTime } from "../../lib/centerTime";
import { NeedsSupportQueue } from "./NeedsSupportQueue";
import { SessionsToMark } from "./SessionsToMark";
import { SelfStudyToConfirm } from "./SelfStudyToConfirm";
import { useSession } from "../../app/session";
import { useTeacherDashboard } from "./queries";

// The next few sessions; a new class brings weeks of them (seen 21/11: Ben had 14 listed).
const UPCOMING_SHOWN = 6;

export function TeacherHome() {
  const { session } = useSession();
  const q = useTeacherDashboard(session?.personaId ?? "");
  const [showAllUpcoming, setShowAllUpcoming] = useState(false);

  if (q.isLoading) return <Spinner label="Loading your teaching" />;
  if (q.isError)
    return <ErrorState message="Could not load your classes." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <EmptyState
        title="No teacher profile for this persona"
        hint="Sign in as the teacher demo persona."
      />
    );

  const d = q.data;
  return (
    <section className="space-y-8">
      <PageHeader title="Teaching" subtitle={`${d.teacherName} · synthetic demo`} />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Classes" value={d.classes.length} />
        <StatTile label="Sessions" value={d.upcoming.length} hint="upcoming" />
        <StatTile
          label="Learners"
          value={d.classes.reduce((sum, c) => sum + c.learnerCount, 0)}
          hint="across your classes"
        />
      </div>

      <SessionsToMark />

      <SelfStudyToConfirm />

      <SpeakingReviewQueue />

      <NeedsSupportQueue />

      <div>
        <h2 className="mb-3 text-lg font-medium">Assigned classes</h2>
        {d.classes.length === 0 ? (
          <EmptyState title="No classes assigned" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {d.classes.map((c) => (
              <li key={c.id}>
                <Card>
                  <h3 className="font-medium">{c.name}</h3>
                  <p className="mt-1 text-sm text-muted">
                    {c.learnerCount} learners · next{" "}
                    {c.nextSessionAt ? formatCenterDate(c.nextSessionAt) : "—"}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Link to={`/app/teaching/classes/${c.id}`}>
                      <Button variant="ghost">Learner overview</Button>
                    </Link>
                    <Link to={`/app/teaching/classes/${c.id}#plan`}>
                      <Button variant="ghost">Lesson planning</Button>
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Upcoming sessions</h2>
        {d.upcoming.length === 0 ? (
          <EmptyState title="No upcoming sessions" />
        ) : (
          <ul className="space-y-2">
            {(showAllUpcoming ? d.upcoming : d.upcoming.slice(0, UPCOMING_SHOWN)).map((s) => (
              <li key={s.id}>
                <Card className="flex items-center justify-between">
                  <span>
                    {s.makeup ? "Make-up · " : ""}
                    {s.title}
                    {s.asSubstitute ? (
                      <span className="ml-2 text-xs text-brand">You substitute</span>
                    ) : s.coveredBy ? (
                      <span className="ml-2 text-xs text-muted">{s.coveredBy} substitutes</span>
                    ) : null}
                  </span>
                  <span className="text-sm text-muted">{formatCenterDateTime(s.at)}</span>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {d.upcoming.length > UPCOMING_SHOWN ? (
          <Button variant="ghost" className="mt-2" onClick={() => setShowAllUpcoming((v) => !v)}>
            {showAllUpcoming
              ? "Show fewer sessions"
              : `Show all ${d.upcoming.length} upcoming sessions`}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
