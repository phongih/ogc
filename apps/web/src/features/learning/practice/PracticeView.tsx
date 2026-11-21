import { useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../../ui";
import { useSession } from "../../../app/session";
import { skillLabel } from "../intelligence/skills";
import { useNextAction } from "../../learner/queries";
import { usePractice, useSubmitPractice } from "./queries";
import { LockedNotice, useActivityLock } from "../PrerequisiteLock";

export function PracticeView() {
  const { session } = useSession();
  const personaId = session?.personaId ?? "";
  const { activityId = "" } = useParams();

  const q = usePractice(personaId, activityId);
  const submit = useSubmitPractice(personaId, activityId);
  const next = useNextAction(personaId);
  const lock = useActivityLock(personaId, activityId);

  // One stable attempt id per mounted attempt → a re-submit is idempotent (no double-count).
  const attemptId = useRef(`ATT-PRAC-${activityId}-${Math.random().toString(36).slice(2, 8)}`).current;
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const result = submit.data?.ok ? submit.data.result : undefined;
  const items = q.data?.items ?? [];
  const allAnswered = useMemo(
    () => items.length > 0 && items.every((i) => answers[i.id]),
    [items, answers],
  );

  if (lock.locked && !submit.data)
    return (
      <section className="space-y-6">
        <PageHeader title="Practice" subtitle="Locked · synthetic" />
        <LockedNotice lock={lock} />
      </section>
    );
  if (q.isLoading) return <Spinner label="Loading practice" />;
  if (q.isError) return <ErrorState message="Could not load this practice." onRetry={() => q.refetch()} />;
  if (!q.data)
    return (
      <EmptyState
        title="Practice not available"
        hint="This activity has no interactive practice, or it isn't in your courses."
      />
    );

  const a = q.data;

  return (
    <section className="space-y-6">
      <PageHeader title={a.title} subtitle={`Practice · ${skillLabel(a.skill)} · synthetic`} />
      <p className="text-sm text-muted">{a.prompt}</p>

      {!result ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate({
              attemptId,
              responses: Object.entries(answers).map(([itemId, optionId]) => ({ itemId, optionId })),
            });
          }}
        >
          <ol className="space-y-4">
            {items.map((item, idx) => (
              <li key={item.id}>
                <Card className="space-y-2">
                  <p className="text-sm font-medium">
                    {idx + 1}. {item.prompt}
                  </p>
                  <fieldset className="space-y-1">
                    <legend className="sr-only">{item.prompt}</legend>
                    {item.options.map((o) => (
                      <label key={o.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={item.id}
                          value={o.id}
                          checked={answers[item.id] === o.id}
                          onChange={() => setAnswers((prev) => ({ ...prev, [item.id]: o.id }))}
                        />
                        <span>{o.text}</span>
                      </label>
                    ))}
                  </fieldset>
                </Card>
              </li>
            ))}
          </ol>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={!allAnswered || submit.isPending}>
              {submit.isPending ? "Submitting…" : "Submit answers"}
            </Button>
            {!allAnswered ? (
              <span className="text-xs text-muted">Answer every question to submit.</span>
            ) : null}
          </div>
          {submit.data && !submit.data.ok ? (
            <p role="alert" className="text-sm text-danger">
              {submit.data.reason === "already_completed"
                ? "You've already completed this practice."
                : "Could not submit this practice."}
            </p>
          ) : null}
        </form>
      ) : (
        <div className="space-y-4">
          <Card className="space-y-2" aria-label="Practice result">
            <p className="text-sm font-medium" role="status">
              You scored <strong>{result.score}%</strong> — {result.correct} of {result.total} correct.
            </p>
            <ul className="space-y-1 text-sm">
              {result.items.map((r, idx) => (
                <li key={r.itemId} className="flex items-center gap-2" data-correct={r.correct}>
                  <span aria-hidden="true">{r.correct ? "✓" : "✗"}</span>
                  <span className={r.correct ? "" : "text-muted"}>Question {idx + 1}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="space-y-2" aria-label="Your next step">
            <p className="text-xs uppercase tracking-wide text-muted">Your next step</p>
            {next.data ? (
              <>
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-xs ${
                    next.data.source === "teacher"
                      ? "border-brand bg-brand text-brand-fg"
                      : "border-border bg-surface"
                  }`}
                >
                  {next.data.source === "teacher" ? "Teacher recommended" : "Suggested for you"}
                </span>
                <p className="text-sm" data-testid="practice-next-reason">
                  {next.data.friendlyReason}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">You&apos;re all caught up — nice work.</p>
            )}
            <Link to="/app/learning" className="inline-block text-sm text-brand">
              ← Back to My Learning
            </Link>
          </Card>
        </div>
      )}
    </section>
  );
}
