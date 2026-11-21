/*
 * P1 · Speaking studio (MOCK). Role-play rehearsal, one turn at a time: the coach says a line,
 * the learner picks the most natural reply and says it out loud. After the last turn the learner
 * sees the model line + pronunciation tips for every turn. Nothing is recorded; no ASR, no AI.
 * The rehearsal counts toward Speaking ONLY after the learner's teacher approves it.
 */
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { SpeakingFeedback } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../../ui";
import { useSession } from "../../../app/session";
import { useMySpeakingFeedback, useSpeakingStudio, useSubmitRehearsal } from "./queries";
import { LockedNotice, useActivityLock } from "../PrerequisiteLock";

const newAttemptId = (activityId: string) =>
  `ATT-SPK-${activityId}-${Math.random().toString(36).slice(2, 8)}`;

export function SpeakingStudio() {
  const { session } = useSession();
  const personaId = session?.personaId ?? "";
  const { activityId = "" } = useParams();
  const studio = useSpeakingStudio(personaId, activityId);
  const prior = useMySpeakingFeedback(personaId, activityId);
  const submit = useSubmitRehearsal(personaId, activityId);
  const lock = useActivityLock(personaId, activityId);

  const attemptId = useRef(newAttemptId(activityId));
  const [rehearsing, setRehearsing] = useState(false);
  const [turn, setTurn] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  if (lock.locked)
    return (
      <section className="space-y-6">
        <PageHeader title="Speaking studio" subtitle="Locked · synthetic" />
        <LockedNotice lock={lock} />
      </section>
    );
  if (studio.isLoading || prior.isLoading) return <Spinner label="Loading speaking studio" />;
  if (studio.isError)
    return (
      <ErrorState
        message="Could not load this speaking practice."
        onRetry={() => studio.refetch()}
      />
    );
  if (!studio.data)
    return (
      <EmptyState
        title="Speaking practice not available"
        hint="This activity has no speaking studio, or it isn't in your courses."
      />
    );

  const s = studio.data;
  const feedback: SpeakingFeedback | null | undefined = submit.data?.ok
    ? submit.data.feedback
    : prior.data;
  const showFeedback = !!feedback && !rehearsing;

  const restart = () => {
    attemptId.current = newAttemptId(activityId);
    setAnswers({});
    setTurn(0);
    submit.reset();
    setRehearsing(true);
  };

  return (
    <section className="space-y-6">
      <PageHeader title={s.title} subtitle="Speaking studio · role-play rehearsal · synthetic" />
      <p className="text-sm text-muted">{s.prompt}</p>
      <p
        className="rounded-ogc border border-border bg-surface p-2 text-xs text-muted"
        data-testid="speaking-disclosure"
      >
        Mock coach — no microphone, no recording, no AI. Your teacher reviews this rehearsal before
        it counts toward Speaking.
      </p>

      {showFeedback ? (
        <FeedbackView feedback={feedback!} items={s.items} onRetry={restart} />
      ) : !rehearsing && !feedback ? (
        <Card className="space-y-3">
          <p className="text-sm">
            {s.items.length} turns. Read each line, choose your reply, then say it out loud before
            you continue.
          </p>
          <Button onClick={() => setRehearsing(true)}>Start rehearsal</Button>
        </Card>
      ) : (
        (() => {
          const item = s.items[turn];
          const last = turn === s.items.length - 1;
          return (
            <Card className="space-y-4" aria-label="Rehearsal turn">
              <p className="text-xs uppercase tracking-wide text-muted">
                Turn {turn + 1} of {s.items.length}
              </p>
              <p className="max-w-md rounded-ogc bg-brand/10 p-3 text-sm" data-testid="coach-line">
                <span className="font-medium">Sam: </span>
                {item.prompt}
              </p>
              <fieldset className="space-y-1">
                <legend className="mb-1 text-sm font-medium">Your reply</legend>
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
              <div className="flex items-center gap-3">
                <Button
                  disabled={!answers[item.id] || submit.isPending}
                  onClick={() => {
                    if (!last) return setTurn((t) => t + 1);
                    setRehearsing(false);
                    submit.mutate({
                      attemptId: attemptId.current,
                      responses: Object.entries(answers).map(([itemId, optionId]) => ({
                        itemId,
                        optionId,
                      })),
                    });
                  }}
                >
                  {last ? "I said it — finish" : "I said it — next"}
                </Button>
                <span className="text-xs text-muted">Say your reply out loud first.</span>
              </div>
              {submit.data && !submit.data.ok ? (
                <p role="alert" className="text-sm text-danger">
                  {submit.data.reason === "already_completed"
                    ? "Your teacher has already approved this speaking practice."
                    : "Could not submit this rehearsal."}
                </p>
              ) : null}
            </Card>
          );
        })()
      )}

      <Link to="/app/learning" className="inline-block text-sm text-brand">
        ← Back to My Learning
      </Link>
    </section>
  );
}

const STATUS_COPY = {
  pending: {
    label: "Waiting for your teacher's review",
    hint: "It will count toward Speaking once your teacher approves it.",
  },
  approved: {
    label: "Approved by your teacher",
    hint: "This rehearsal now counts toward your Speaking skill.",
  },
  returned: {
    label: "Your teacher asked you to try again",
    hint: "Rehearse once more, then it goes back for review.",
  },
} as const;

function FeedbackView({
  feedback,
  items,
  onRetry,
}: {
  feedback: SpeakingFeedback;
  items: { id: string; prompt: string; options: { id: string; text: string }[] }[];
  onRetry: () => void;
}) {
  const { result, coach, review } = feedback;
  const copy = STATUS_COPY[review.status];
  return (
    <div className="space-y-4">
      <Card className="space-y-2" aria-label="Review status">
        <div data-review-status={review.status} className="space-y-1">
          <p className="font-medium" role="status">
            {copy.label}
          </p>
          <p className="text-sm text-muted">{copy.hint}</p>
          {review.status === "returned" && review.reviewerNote ? (
            <blockquote
              className="border-l-2 border-brand pl-3 text-sm"
              data-testid="speaking-teacher-note"
            >
              <span className="text-muted">Your teacher: </span>“{review.reviewerNote}”
            </blockquote>
          ) : null}
          <p className="text-sm">
            <strong>
              {result.correct} of {result.total}
            </strong>{" "}
            replies were the most natural choice.
          </p>
        </div>
        {review.status !== "approved" ? (
          <Button variant="ghost" onClick={onRetry}>
            Rehearse again
          </Button>
        ) : null}
      </Card>

      <ol className="space-y-3" aria-label="Coaching by turn">
        {items.map((item, idx) => {
          const r = result.items.find((x) => x.itemId === item.id);
          const chosen = item.options.find((o) => o.id === r?.chosenOptionId)?.text ?? "—";
          const c = coach.find((x) => x.itemId === item.id);
          return (
            <li key={item.id}>
              <Card className="space-y-2">
                <div data-natural={r?.correct ? "true" : "false"} className="space-y-2">
                  <p className="text-xs uppercase tracking-wide text-muted">Turn {idx + 1}</p>
                  <p className="text-sm">
                    <span className="font-medium">Sam: </span>
                    {item.prompt}
                  </p>
                  <p className="text-sm">
                    <span aria-hidden="true">{r?.correct ? "✓" : "✗"}</span>{" "}
                    <span className="text-muted">You said:</span> {chosen}
                  </p>
                  {c ? (
                    <>
                      <p className="text-sm">
                        <span className="text-muted">A natural way to say it:</span>{" "}
                        <span className="font-medium">{c.modelLine}</span>
                      </p>
                      <ul
                        className="space-y-1 text-sm"
                        aria-label={`Pronunciation tips for turn ${idx + 1}`}
                      >
                        {c.tips.map((t) => (
                          <li key={t.focus}>
                            <span className="font-medium">{t.focus}</span>{" "}
                            <span className="text-muted">{t.ipa}</span> — {t.tip}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
