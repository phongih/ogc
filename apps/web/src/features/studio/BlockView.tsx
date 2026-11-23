/*
 * Course Studio — how a block READS (preview, published versions, the learner's lesson). Plain
 * text only (never HTML). Video is a link that opens in a new tab — OGC never embeds it.
 * Interactive parts (quiz choice, reflection answer, speaking replies) are passed in by the learner
 * player. A speaking rehearsal counts for Speaking only once the class teacher approves it.
 */
import type { CourseBlock, SpeakingAttemptView } from "@ogc/contracts";

const TONE: Record<string, { label: string; cls: string }> = {
  info: { label: "Note", cls: "border-brand" },
  tip: { label: "Tip", cls: "border-fg" },
  warning: { label: "Careful", cls: "border-danger" },
};

export interface Interaction {
  answer?: number | undefined;
  onAnswer?: (i: number) => void;
  reflection?: string;
  onReflection?: (t: string) => void;
  revealed?: boolean; // after completion: show the correct option
  // speaking: the reply picked at each turn, and the latest attempt's review (Platform)
  choices?: (number | undefined)[];
  onChoose?: (turn: number, option: number) => void;
  attempt?: SpeakingAttemptView | null;
}

const SPEAKING_STATUS: Record<SpeakingAttemptView["status"], string> = {
  pending: "Waiting for your teacher — it counts for Speaking once approved",
  approved: "Approved by your teacher — counts for Speaking",
  returned: "Returned by your teacher — try again",
};

export function BlockView({ b, io }: { b: CourseBlock; io?: Interaction }) {
  switch (b.kind) {
    case "heading":
      return <h3 className="text-lg font-semibold">{b.text || "Untitled heading"}</h3>;
    case "text":
      return <p className="whitespace-pre-line">{b.text}</p>;
    case "callout": {
      const t = TONE[b.tone] ?? TONE.info;
      return (
        <aside className={`rounded-ogc border-l-4 bg-surface p-3 ${t.cls}`} aria-label={t.label}>
          <p className="text-xs uppercase text-muted">{t.label}</p>
          <p className="whitespace-pre-line">{b.text}</p>
        </aside>
      );
    }
    case "divider":
      return <hr className="border-border" />;
    case "vocab":
      return (
        <div
          className="flex gap-3 rounded-ogc border border-border p-3"
          aria-label={`Vocabulary: ${b.word}`}
        >
          {b.imageUrl ? (
            <img
              src={b.imageUrl}
              alt={b.word}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-16 w-16 rounded-ogc object-cover"
            />
          ) : null}
          <div>
            <p className="font-semibold">{b.word}</p>
            <p className="text-sm">{b.meaning}</p>
            {b.example ? <p className="text-sm italic text-muted">“{b.example}”</p> : null}
            {b.translation ? <p className="text-sm text-muted">→ {b.translation}</p> : null}
          </div>
        </div>
      );
    case "quiz":
      return (
        <fieldset className="rounded-ogc border border-border p-3">
          <legend className="px-1 font-medium">{b.question || "Question"}</legend>
          <ul className="space-y-1">
            {b.options.map((o, i) => {
              const right = io?.revealed && b.correct === i;
              const picked = io?.answer === i;
              return (
                <li key={i}>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`quiz-${b.id}`}
                      checked={picked}
                      disabled={!io?.onAnswer}
                      onChange={() => io?.onAnswer?.(i)}
                    />
                    <span className={right ? "font-semibold underline" : ""}>
                      {o || `Option ${i + 1}`}
                      {right ? " ✓" : ""}
                      {io?.revealed && picked && !right ? " ✗" : ""}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          {!io ? (
            <p className="mt-1 text-xs text-muted">
              Correct: {b.options[b.correct] || `option ${b.correct + 1}`}
            </p>
          ) : null}
        </fieldset>
      );
    case "video":
      return (
        <p>
          <a
            href={b.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline"
          >
            ▶ {b.caption || "Watch the video"} ↗
          </a>
        </p>
      );
    case "reflection":
      return (
        <div className="space-y-1">
          <p className="font-medium">✎ {b.prompt || "Reflection"}</p>
          {io ? (
            <textarea
              aria-label={`Reflection: ${b.prompt}`}
              className="w-full rounded-ogc border border-border bg-surface p-2"
              rows={3}
              value={io.reflection ?? ""}
              readOnly={!io.onReflection}
              onChange={(e) => io.onReflection?.(e.target.value)}
            />
          ) : (
            <p className="text-xs text-muted">
              The learner answers in their own words (not scored).
            </p>
          )}
        </div>
      );
    case "speaking":
      return (
        <section
          aria-label={`Speaking: ${b.scenario || "rehearsal"}`}
          className="space-y-2 rounded-ogc border border-border p-3"
        >
          <p className="font-medium">🗣 {b.scenario || "Speaking rehearsal"}</p>
          <p className="text-xs text-muted">
            {io
              ? "For each line, choose the most natural reply, then say it out loud."
              : "The learner picks and says a reply at each turn; the class teacher approves it before it counts for Speaking."}
          </p>
          <ol className="space-y-2">
            {b.turns.map((t, i) => {
              const picked = io?.choices?.[i];
              return (
                <li key={i} className="space-y-1">
                  <p className="text-sm">
                    <span className="text-muted">Coach:</span> {t.coach || `Turn ${i + 1}`}
                  </p>
                  <ul className="space-y-0.5 pl-3">
                    {t.options.map((o, j) => {
                      const natural = (io?.revealed || !io) && t.natural === j;
                      return (
                        <li key={j}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="radio"
                              name={`speaking-${b.id}-${i}`}
                              aria-label={`Turn ${i + 1}: ${o}`}
                              checked={picked === j}
                              disabled={!io?.onChoose}
                              onChange={() => io?.onChoose?.(i, j)}
                            />
                            <span className={natural ? "font-semibold underline" : ""}>
                              {o || `Reply ${j + 1}`}
                              {natural ? " ✓" : ""}
                              {io?.revealed && picked === j && t.natural !== j ? " ✗" : ""}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {(io?.revealed || !io) && t.model ? (
                    <p className="pl-3 text-xs">
                      Say it like this: “{t.model}”{t.tip ? ` · ${t.tip}` : ""}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {io?.attempt ? (
            <p
              className={`text-sm ${io.attempt.status === "returned" ? "text-danger" : ""}`}
              data-testid={`speaking-status-${b.id}`}
            >
              {SPEAKING_STATUS[io.attempt.status]} · natural replies {io.attempt.score}%
              {io.attempt.attempt > 1 ? ` · try ${io.attempt.attempt}` : ""}
              {io.attempt.note ? ` · “${io.attempt.note}”` : ""}
            </p>
          ) : null}
        </section>
      );
  }
}

export function LessonView({
  blocks,
  io,
}: {
  blocks: CourseBlock[];
  io?: (b: CourseBlock) => Interaction | undefined;
}) {
  return (
    <div className="space-y-3">
      {blocks.map((b) => (
        <BlockView key={b.id} b={b} io={io?.(b)} />
      ))}
    </div>
  );
}
