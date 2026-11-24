/*
 * Course Studio — how a block READS (preview, published versions, the learner's lesson). Plain
 * text only (never HTML). Video is a link that opens in a new tab — OGC never embeds it.
 * Interactive parts (quiz choice, reflection answer, speaking replies) are passed in by the learner
 * player. A speaking rehearsal counts for Speaking only once the class teacher approves it.
 */
import { useState } from "react";
import {
  detectiveCards,
  matchChoices,
  normalizeBlock,
  type BlockOf,
  type CourseBlock,
  type SpeakingAttemptView,
} from "@ogc/contracts";

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
  // practice / Eagle Flight Match / Time Detective: the learner's answer (XP only)
  practice?: number[];
  onPractice?: (c: number[]) => void;
}

const SPEAKING_STATUS: Record<SpeakingAttemptView["status"], string> = {
  pending: "Waiting for your teacher — it counts for Speaking once approved",
  approved: "Approved by your teacher — counts for Speaking",
  returned: "Returned by your teacher — try again",
};

export function BlockView({ b: raw, io }: { b: CourseBlock; io?: Interaction }) {
  const b = normalizeBlock(raw); // an older single vocabulary card reads as a deck of one
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
      return <VocabDeck b={b} interactive={!!io} />;
    case "image":
      return (
        <figure className="space-y-1">
          {b.url ? (
            <img
              src={b.url}
              alt={b.caption || "Illustration"}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="max-h-80 rounded-ogc object-cover"
            />
          ) : (
            <p className="text-sm text-muted">No image link yet.</p>
          )}
          {b.caption || b.credit ? (
            <figcaption className="text-xs text-muted">
              {b.caption}
              {b.caption && b.credit ? " · " : ""}
              {b.credit ? `Credit: ${b.credit}` : ""}
            </figcaption>
          ) : null}
        </figure>
      );
    case "book_page":
      return <BookPages b={b} interactive={!!io} />;
    case "practice":
      return <Practice b={b} io={io} />;
    case "eagle_match":
      return <EagleMatch b={b} io={io} />;
    case "time_detective":
      return <TimeDetective b={b} io={io} />;
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

function VocabDeck({ b, interactive }: { b: BlockOf<"vocab">; interactive: boolean }) {
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  return (
    <section aria-label={`Vocabulary: ${b.title || "cards"}`} className="space-y-2">
      {b.title ? <p className="font-medium">{b.title}</p> : null}
      <ul className="grid gap-2 sm:grid-cols-3">
        {b.cards.map((c, i) => {
          const back = !interactive || flipped[i];
          return (
            <li
              key={i}
              className="rounded-ogc border border-border p-3"
              aria-label={`Card: ${c.word}`}
            >
              {c.imageUrl ? (
                <img
                  src={c.imageUrl}
                  alt={c.word}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="mb-1 h-16 w-16 rounded-ogc object-cover"
                />
              ) : null}
              <p className="font-semibold">{c.word || `Card ${i + 1}`}</p>
              {back ? (
                <>
                  <p className="text-sm">{c.meaning}</p>
                  {c.example ? <p className="text-sm italic text-muted">“{c.example}”</p> : null}
                  {c.translation ? <p className="text-sm text-muted">→ {c.translation}</p> : null}
                </>
              ) : null}
              {interactive ? (
                <button
                  type="button"
                  className="mt-1 text-xs text-brand underline"
                  onClick={() => setFlipped((f) => ({ ...f, [i]: !f[i] }))}
                >
                  {flipped[i] ? "Hide" : "Flip"} {c.word}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BookPages({ b, interactive }: { b: BlockOf<"book_page">; interactive: boolean }) {
  const [at, setAt] = useState(0);
  const pages = interactive ? [b.pages[at]!] : b.pages;
  return (
    <section
      aria-label={`Book: ${b.title || "reading"}`}
      className="space-y-2 rounded-ogc border border-border p-3"
    >
      {b.title ? <p className="font-medium">📖 {b.title}</p> : null}
      {pages.map((pg, i) => (
        <article key={i} className="space-y-1">
          {pg.heading ? <h4 className="font-semibold">{pg.heading}</h4> : null}
          <p className="whitespace-pre-line">{pg.body}</p>
        </article>
      ))}
      {interactive && b.pages.length > 1 ? (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={at === 0}
            onClick={() => setAt(at - 1)}
            className="text-brand disabled:opacity-40"
          >
            ← Previous page
          </button>
          <span data-testid={`page-${b.id}`}>
            Page {at + 1} of {b.pages.length}
          </span>
          <button
            type="button"
            disabled={at === b.pages.length - 1}
            onClick={() => setAt(at + 1)}
            className="text-brand disabled:opacity-40"
          >
            Next page →
          </button>
        </div>
      ) : null}
    </section>
  );
}

const XP_ONLY = "Practice — counts for XP only, not for your skill profile.";

function Practice({ b, io }: { b: BlockOf<"practice">; io?: Interaction }) {
  const c = io?.practice ?? [];
  return (
    <section
      aria-label={`Practice: ${b.title || "questions"}`}
      className="space-y-2 rounded-ogc border border-border p-3"
    >
      <p className="font-medium">✏️ {b.title || "Practice"}</p>
      <p className="text-xs text-muted">
        {io ? XP_ONLY : "Scored for XP only — never for the skill profile."}
      </p>
      <ol className="list-decimal space-y-2 pl-5">
        {b.questions.map((q, i) => (
          <li key={i}>
            <p className="text-sm">{q.question || `Question ${i + 1}`}</p>
            <ul className="space-y-0.5">
              {q.options.map((o, j) => {
                const right = (io?.revealed || !io) && q.correct === j;
                return (
                  <li key={j}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={`practice-${b.id}-${i}`}
                        aria-label={`Question ${i + 1}: ${o}`}
                        checked={c[i] === j}
                        disabled={!io?.onPractice}
                        onChange={() => {
                          const next = [...c];
                          next[i] = j;
                          io?.onPractice?.(next);
                        }}
                      />
                      <span className={right ? "font-semibold underline" : ""}>
                        {o || `Option ${j + 1}`}
                        {right ? " ✓" : ""}
                        {io?.revealed && c[i] === j && q.correct !== j ? " ✗" : ""}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function EagleMatch({ b, io }: { b: BlockOf<"eagle_match">; io?: Interaction }) {
  // the learner's view carries the right-hand side as `choices`; a full block derives them
  const choices = b.choices ?? matchChoices(b);
  const c = io?.practice ?? [];
  return (
    <section
      aria-label={`Match: ${b.prompt || "pairs"}`}
      className="space-y-2 rounded-ogc border border-border p-3"
    >
      <p className="font-medium">🦅 {b.prompt || "Eagle Flight Match"}</p>
      <p className="text-xs text-muted">
        {io ? `Match each item — each answer once. ${XP_ONLY}` : "Scored for XP only."}
      </p>
      <ul className="space-y-1">
        {b.pairs.map((p, i) => {
          const picked = c[i];
          const ok = io?.revealed && picked !== undefined && choices[picked] === p.right;
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-32 font-medium">{p.left || `Item ${i + 1}`}</span>
              {io ? (
                <select
                  aria-label={`Match for ${p.left}`}
                  className="rounded-ogc border border-border bg-surface p-1"
                  value={picked ?? ""}
                  disabled={!io.onPractice}
                  onChange={(e) => {
                    const next = [...c];
                    next[i] = Number(e.target.value);
                    io.onPractice?.(next);
                  }}
                >
                  <option value="">—</option>
                  {choices.map((t, j) => (
                    <option key={j} value={j}>
                      {t}
                    </option>
                  ))}
                </select>
              ) : (
                <span>→ {p.right}</span>
              )}
              {io?.revealed ? <span>{ok ? "✓" : `✗ (${p.right})`}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TimeDetective({ b, io }: { b: BlockOf<"time_detective">; io?: Interaction }) {
  // the learner's view has the events in the shown order; a full block derives that order
  const shown = io?.revealed ? detectiveCards(b) : b.events;
  const order = io?.practice?.length ? io.practice : shown.map((_, i) => i);
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    io?.onPractice?.(next);
  };
  return (
    <section
      aria-label={`Order: ${b.prompt || "events"}`}
      className="space-y-2 rounded-ogc border border-border p-3"
    >
      <p className="font-medium">🕵️ {b.prompt || "Time Detective"}</p>
      <p className="text-xs text-muted">
        {io
          ? `Put the events in order, first at the top. ${XP_ONLY}`
          : "Written in the right order; learners get them mixed up. Scored for XP only."}
      </p>
      <ol className="list-decimal space-y-1 pl-5" aria-label={`Order of ${b.prompt}`}>
        {(io ? order.map((j) => shown[j]!) : b.events).map((t, i) => (
          <li key={`${t}-${i}`} className="text-sm">
            <span className="mr-2">{t || `Event ${i + 1}`}</span>
            {io?.onPractice ? (
              <>
                <button
                  type="button"
                  aria-label={`Move up: ${t}`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="px-1 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move down: ${t}`}
                  disabled={i === order.length - 1}
                  onClick={() => move(i, 1)}
                  className="px-1 disabled:opacity-30"
                >
                  ↓
                </button>
              </>
            ) : null}
            {io?.revealed ? <span>{b.events[i] === t ? "✓" : `✗ (${b.events[i]})`}</span> : null}
          </li>
        ))}
      </ol>
    </section>
  );
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
