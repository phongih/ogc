/*
 * P1 · "Today's mission" — ONE next best action at the top of the learner home (design principle 01).
 *
 * Presentation only. The mission IS the existing learner next action (LI-3 recommendation, or the
 * teacher-applied override from AUTH-026); no new decision logic. Duration is not invented: the
 * card shows the real number of questions when the activity has an interactive practice set.
 * SYNTHETIC / NON-PRODUCTION.
 */
import { Link } from "react-router-dom";
import type { LearnerNextAction } from "@ogc/contracts";
import { Button, Card } from "../../ui";
import { activities } from "../../fixtures/activities";
import { practiceFor } from "../../fixtures/practice";
import { skillLabel } from "../learning/intelligence/skills";

export function missionTitle(action: LearnerNextAction): string {
  return (
    activities.find((a) => a.id === action.activityId)?.title ??
    `${skillLabel(action.skill)} practice`
  );
}

export function TodaysMission({ action }: { action: LearnerNextAction | null | undefined }) {
  if (!action) {
    return (
      <section aria-label="Today's mission">
        <Card className="border-brand/40">
          <p className="text-xs uppercase tracking-wide text-muted">Today&apos;s mission</p>
          <p className="mt-1 font-medium">You&apos;re all caught up — nice work.</p>
          <p className="mt-1 text-sm text-muted">
            New practice will appear here when it is ready for you.
          </p>
        </Card>
      </section>
    );
  }

  const practice = practiceFor(action.activityId);
  const fromTeacher = action.source === "teacher";

  return (
    <section aria-label="Today's mission">
      <Card className="border-brand/40 bg-brand/5">
        <div data-source={action.source} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-muted">Today&apos;s mission</p>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs ${
                fromTeacher ? "border-brand bg-brand text-brand-fg" : "border-border bg-surface"
              }`}
            >
              {fromTeacher ? "Teacher recommended" : "Suggested for you"}
            </span>
          </div>

          <div>
            <h2 className="text-xl font-semibold" data-testid="mission-title">
              {missionTitle(action)}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {skillLabel(action.skill)}
              {practice ? ` · ${practice.items.length} questions` : ""}
            </p>
          </div>

          <p className="text-sm" data-testid="li-recommendation-reason">
            {action.friendlyReason}
          </p>

          {fromTeacher && action.teacherNote ? (
            <blockquote
              className="border-l-2 border-brand pl-3 text-sm"
              data-testid="mission-teacher-note"
            >
              <span className="text-muted">Your teacher: </span>“{action.teacherNote}”
            </blockquote>
          ) : null}

          <div className="flex flex-wrap items-center gap-4">
            {practice ? (
              <Link to={`/app/learning/practice/${action.activityId}`} className="inline-block">
                <Button>Practice now</Button>
              </Link>
            ) : (
              <Link to={`/app/learning/courses/${action.courseId}`} className="inline-block">
                <Button>Start now</Button>
              </Link>
            )}
            {practice ? (
              <Link
                to={`/app/learning/courses/${action.courseId}`}
                className="text-sm text-muted underline"
              >
                Open the course
              </Link>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}
