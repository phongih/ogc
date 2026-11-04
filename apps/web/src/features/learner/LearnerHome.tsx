import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, ProgressRing, Spinner, StatTile } from "../../ui";
import { useSession } from "../../app/session";
import { useAchievements, useLearnerDashboard, useLearnerProfile, useRecommendation } from "./queries";
import { relativeDay } from "../../lib/time";
import { ALL_SKILLS, skillLabel } from "../learning/intelligence/skills";

export function LearnerHome() {
  const { session } = useSession();
  const q = useLearnerDashboard(session?.personaId ?? "");
  const achievements = useAchievements(session?.personaId ?? "");
  const liProfile = useLearnerProfile(session?.personaId ?? "");
  const nextStep = useRecommendation(session?.personaId ?? "");

  if (q.isLoading) return <Spinner label="Loading your learning" />;
  if (q.isError) return <ErrorState message="Could not load your learning." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="No learner profile for this persona" hint="Sign in as the learner demo persona." />;

  const d = q.data;
  // Overall progress uses equal course weighting (per Slice-5 decision: equal_course_weight).
  const overallPct =
    d.enrolled.length > 0
      ? Math.round(d.enrolled.reduce((sum, e) => sum + e.progressPct, 0) / d.enrolled.length)
      : 0;
  const inProgress = d.enrolled.filter((e) => e.state === "in_progress").length;

  return (
    <section className="space-y-8">
      <PageHeader title="My Learning" subtitle={`${d.learnerName} · synthetic demo`} />

      {d.enrolled.length > 0 ? (
        <Card className="flex items-center gap-5">
          <ProgressRing pct={overallPct} label="Overall learning progress" />
          <div>
            <p className="font-medium">Overall progress</p>
            <p className="mt-1 text-sm text-muted">
              {d.enrolled.length} course{d.enrolled.length === 1 ? "" : "s"} · {inProgress} in progress ·
              equal-weight average
            </p>
          </div>
        </Card>
      ) : null}

      {d.enrolled.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="Courses" value={d.enrolled.length} />
          <StatTile label="In progress" value={inProgress} />
          <StatTile label="Upcoming" value={d.upcoming.length} hint="lessons" />
        </div>
      ) : null}

      {liProfile.data ? (
        <div>
          <h2 className="mb-3 text-lg font-medium">Learning intelligence</h2>
          <Card className="space-y-4" aria-label="Learning intelligence">
            {nextStep.data ? (
              <div className="rounded-ogc border border-brand/40 bg-brand/5 p-3">
                <p className="text-xs uppercase tracking-wide text-muted">Your next step</p>
                <p className="mt-1 text-sm" data-testid="li-recommendation-reason">
                  {nextStep.data.reason}
                </p>
                <Link to={`/app/learning/courses/${nextStep.data.courseId}`} className="mt-2 inline-block">
                  <Button variant="ghost">Practise now</Button>
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted">No next step — you&apos;re all caught up.</p>
            )}

            <div>
              <p className="mb-2 text-sm font-medium">
                Skill mastery <span className="text-muted">· CEFR {liProfile.data.cefrBand}</span>
              </p>
              <ul className="space-y-2" aria-label="Skill mastery">
                {ALL_SKILLS.map((s) => {
                  const m = liProfile.data!.skills[s];
                  return (
                    <li key={s}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{skillLabel(s)}</span>
                        <span className="text-muted" aria-label={`${skillLabel(s)} mastery ${m.level}`}>
                          {m.level}
                          <span className="ml-1 text-xs">
                            ({m.evidenceCount} evidence)
                          </span>
                        </span>
                      </div>
                      <ProgressBar
                        pct={m.level}
                        label={`${skillLabel(s)} mastery ${m.level} percent`}
                        className="mt-1"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>
          </Card>
        </div>
      ) : null}

      {achievements.data ? (
        <div>
          <h2 className="mb-3 text-lg font-medium">Streak &amp; achievements</h2>
          <Card className="space-y-3">
            <p className="text-sm">
              <span aria-hidden="true">🔥</span> <strong>{achievements.data.streakDays}-day</strong> learning streak
            </p>
            <ul className="flex flex-wrap gap-2">
              {achievements.data.badges.map((b) => (
                <li key={b.id}>
                  <span
                    aria-label={`${b.title} ${b.earned ? "(earned)" : "(locked)"}`}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                      b.earned ? "border-border bg-surface" : "border-border/50 text-muted opacity-60"
                    }`}
                  >
                    <span aria-hidden="true">{b.icon}</span> {b.title}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <div>
        <h2 className="mb-3 text-lg font-medium">Enrolled courses</h2>
        {d.enrolled.length === 0 ? (
          <EmptyState title="No enrolled courses" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {d.enrolled.map((e) => (
              <li key={e.course.id}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-medium">{e.course.title}</h3>
                      <p className="text-sm text-muted">
                        {e.course.level} · {e.state.replace("_", " ")}
                      </p>
                    </div>
                    <span className="text-sm text-muted">{e.progressPct}%</span>
                  </div>
                  <ProgressBar pct={e.progressPct} className="mt-2" />
                  <div className="mt-3 flex gap-2">
                    <Link to={`/app/learning/courses/${e.course.id}`}>
                      <Button variant="ghost">Resume learning</Button>
                    </Link>
                    <Link to={`/app/catalog/${e.course.id}`}>
                      <Button variant="ghost">Course details</Button>
                    </Link>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Upcoming lessons</h2>
        {d.upcoming.length === 0 ? (
          <EmptyState title="Nothing scheduled" />
        ) : (
          <ul className="space-y-2" aria-label="Upcoming lessons">
            {d.upcoming.map((l) => (
              <li key={l.id}>
                <Link to={`/app/learning/courses/${l.courseId}`} className="block">
                  <Card className="flex items-center justify-between transition hover:border-brand">
                    <span>{l.title}</span>
                    <span className="text-sm text-muted">
                      {relativeDay(l.scheduledAt)}
                      {l.scheduledAt
                        ? ` · ${new Date(l.scheduledAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}`
                        : ""}{" "}
                      · {l.durationMin}m
                    </span>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
