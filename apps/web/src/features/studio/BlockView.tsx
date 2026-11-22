/*
 * Course Studio — how a block READS (preview, published versions, the learner's lesson). Plain
 * text only (never HTML). Video is a link that opens in a new tab — OGC never embeds it.
 * Interactive parts (quiz choice, reflection answer) are passed in by the learner player.
 */
import type { CourseBlock } from "@ogc/contracts";

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
}

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
