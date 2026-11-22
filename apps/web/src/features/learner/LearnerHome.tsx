import { Link } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, ProgressRing, Spinner, StatTile } from "../../ui";
import { useSession } from "../../app/session";
import {
  useAchievements,
  useLearnerDashboard,
  useLearnerProfile,
  useMasteryConfidence,
  useLearningPath,
  useNextAction,
} from "./queries";
import { relativeDay } from "../../lib/time";
import { CENTER_UTC_OFFSET_MIN, formatCenterDateTime } from "../../lib/centerTime";
import { ALL_SKILLS, skillLabel } from "../learning/intelligence/skills";
import { confidenceWord, masteryWord } from "../learning/intelligence/friendly";
import { TodaysMission } from "./TodaysMission";
import { MyMakeups } from "./MyMakeups";

export function LearnerHome() {
  const { session } = useSession();
  const q = useLearnerDashboard(session?.personaId ?? "");
  const achievements = useAchievements(session?.personaId ?? "");
  const liProfile = useLearnerProfile(session?.personaId ?? "");
  const path = useLearningPath(session?.personaId ?? "");
  const next = useNextAction(session?.personaId ?? "");
  const confidence = useMasteryConfidence(session?.personaId ?? "");

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

      {/* P1 · one next best action first (design principle 01). Everything else is context below. */}
      {liProfile.data && !next.isLoading ? <TodaysMission action={next.data} /> : null}

      <MyMakeups />

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
            <div>
              <p className="mb-2 text-sm font-medium">
                Skill mastery <span className="text-muted">· CEFR {liProfile.data.cefrBand}</span>
              </p>
              <ul className="space-y-2" aria-label="Skill mastery">
                {ALL_SKILLS.map((s) => {
                  const m = liProfile.data!.skills[s];
                  const band = confidence.data?.skills[s]?.band;
                  return (
                    <li key={s}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{skillLabel(s)}</span>
                        <span className="text-muted" aria-label={`${skillLabel(s)} mastery ${m.level}`}>
                          {masteryWord(m.level)}
                          {band ? <span className="ml-1 text-xs">· {confidenceWord(band)}</span> : null}
                          <span className="ml-1 text-xs opacity-60">({m.level})</span>
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

      {path.data && path.data.steps.length > 0 ? (
        <div>
          <h2 className="mb-3 text-lg font-medium">Learning path</h2>
          <Card className="space-y-2" aria-label="Learning path">
            {!path.data.graph.valid ? (
              <p className="rounded-ogc border border-border/60 bg-surface p-2 text-xs text-muted" role="status">
                Some activities are locked by an unresolved prerequisite and are held back.
              </p>
            ) : null}
            <ol className="space-y-1" aria-label="Path steps">
              {path.data.steps.map((s) => {
                const icon = s.state === "completed" ? "✓" : s.state === "available" ? "→" : "🔒";
                return (
                  <li
                    key={s.activityId}
                    data-state={s.state}
                    className="flex items-center justify-between gap-3 rounded-ogc px-2 py-1.5 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true">{icon}</span>
                      <span className={s.state === "blocked" ? "text-muted" : ""}>{s.title}</span>
                    </span>
                    <span className="text-xs text-muted">
                      {skillLabel(s.skill)} ·{" "}
                      <span aria-label={`state ${s.state}`}>{s.state}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
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
                      {relativeDay(l.scheduledAt, Date.now(), CENTER_UTC_OFFSET_MIN)}
                      {l.scheduledAt
                        ? ` · ${formatCenterDateTime(l.scheduledAt)}`
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
