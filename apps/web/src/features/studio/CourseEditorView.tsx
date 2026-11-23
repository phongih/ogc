/*
 * Course Studio — one course: the block editor, review and history (owner decisions 22/11).
 * Draft → submit for review → a different person approves → immutable published version.
 * Teachers edit their own courses, staff every course of the org (courses:author). SYNTHETIC.
 */
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AuthoredCourseDetail,
  AuthoredStatus,
  AuthoringResult,
  BlockKind,
  CourseBlock,
  CourseContent,
  CourseLesson,
} from "@ogc/contracts";
import { AUTHORING_LIMITS, BLOCK_KINDS, BLOCK_REGISTRY, contentIssue } from "@ogc/contracts";
import { useCourseStudioApi } from "./courseStudioApi";
import { formatCenterDate, formatCenterDateTime } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { LessonView } from "./BlockView";

export const AUTHORED_STATUS: Record<AuthoredStatus, string> = {
  draft: "Draft — never published",
  in_review: "In review",
  published: "Published",
  unpublished_changes: "Published · unpublished changes",
};
const REFUSAL: Record<string, string> = {
  not_allowed: "Not allowed",
  not_found: "Not found.",
  invalid: "Not valid",
  invalid_step: "Not at this step",
  conflict: "Changed by someone else",
  own_step: "Someone else must do this",
  access_policy: "Your access policy does not allow this.",
};

export function Refused({ r }: { r: AuthoringResult | undefined }) {
  if (!r || r.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[r.reason] ?? r.reason}
      {r.detail ? `: ${r.detail}` : ""}
    </p>
  );
}

let idSeq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}${(++idSeq).toString(36)}`;
const input = "w-full rounded-ogc border border-border bg-surface p-1";

export function CourseEditorView({ base }: { base: string }) {
  const { ref = "" } = useParams();
  const api = useCourseStudioApi();
  const q = useQuery({
    queryKey: [...api.key, "course", ref],
    queryFn: () => api.get(ref),
  });
  if (q.isLoading) return <Spinner label="Loading the course" />;
  if (q.isError)
    return <ErrorState message="Could not load the course." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Course not found" hint="Or it is not in your view." />;
  return (
    <CourseScreen
      key={`${q.data.ref}:${q.data.draftRevision}:${q.data.status}`}
      c={q.data}
      base={base}
    />
  );
}

function CourseScreen({ c, base }: { c: AuthoredCourseDetail; base: string }) {
  const api = useCourseStudioApi();
  const editable = c.canEdit && !c.pending;
  return (
    <section className="space-y-4">
      <PageHeader
        title={c.title}
        subtitle={`${c.ref} · ${c.level || "—"} · ${c.ownerName} · ${api.note}`}
      />
      <p className="text-sm" data-testid="course-status">
        <span className="font-medium">{AUTHORED_STATUS[c.status]}</span>
        {c.publishedVersion ? ` · learners get v${c.publishedVersion}` : ""}
        {c.linkedClasses.length ? ` · followed by ${c.linkedClasses.join(", ")}` : ""}
      </p>
      {c.status === "unpublished_changes" ? (
        <p className="text-xs text-muted">
          The draft differs from v{c.publishedVersion}. Learners keep the published version until a
          new one is approved.
        </p>
      ) : null}
      {c.canEdit && c.pending ? (
        <p className="text-xs text-muted">In review — withdraw it to edit again.</p>
      ) : null}
      {!c.canEdit ? (
        <p className="text-xs text-muted">
          Read only — {c.publishedVersion ? `published v${c.publishedVersion}` : "the draft"}.
        </p>
      ) : null}
      <ReviewPanel c={c} />
      {editable ? <Editor c={c} /> : <ReadOnly content={c.pending?.content ?? c.draft} />}
      <History c={c} />
      <Link to={base} className="inline-block text-sm text-brand">
        ← Course Studio
      </Link>
    </section>
  );
}

function useAct() {
  const qc = useQueryClient();
  const api = useCourseStudioApi();
  return useMutation({
    mutationFn: (run: () => Promise<AuthoringResult>) => run(),
    onSuccess: (r) => {
      if (r.ok) void api.onChanged(qc);
    },
  });
}

// ── review ───────────────────────────────────────────────────────────────────────────────────
function ReviewPanel({ c }: { c: AuthoredCourseDetail }) {
  const api = useCourseStudioApi();
  const act = useAct();
  const [note, setNote] = useState("");
  const last = c.reviews.find((r) => r.action === "returned" || r.action === "approved");
  return (
    <Card>
      <section aria-label="Review" className="space-y-2 text-sm">
        <h2 className="font-semibold">Review</h2>
        {c.status === "in_review" ? (
          <p>
            Submitted
            {c.pending
              ? ` by ${c.pending.submittedBy} ${formatCenterDateTime(c.pending.submittedAt)}`
              : ""}
            .{" "}
            {c.canReview
              ? "You may approve it (it becomes the next published version) or return it with a note."
              : c.reviewBlockedReason
                ? `Waiting for a reviewer — ${c.reviewBlockedReason}.`
                : "Waiting for a reviewer."}
          </p>
        ) : last?.action === "returned" && c.status !== "published" ? (
          <p>
            Returned by {last.by}: “{last.note}”
          </p>
        ) : (
          <p className="text-muted">Not in review.</p>
        )}
        {c.editorsSinceLastPublication.length ? (
          <p className="text-xs text-muted">
            Edited since the last publication by {c.editorsSinceLastPublication.join(", ")} — they
            cannot approve it.
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {c.canEdit && c.pending ? (
            <Button variant="ghost" onClick={() => act.mutate(() => api.withdraw(c.ref))}>
              Withdraw from review
            </Button>
          ) : null}
          {c.canReview ? (
            <>
              <input
                aria-label="Review note"
                placeholder="Note (required to return)"
                className="min-w-64 rounded-ogc border border-border bg-surface p-1"
                value={note}
                maxLength={AUTHORING_LIMITS.note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Button onClick={() => act.mutate(() => api.approve(c.ref, note))}>
                Approve and publish v{(c.publishedVersion ?? 0) + 1}
              </Button>
              <Button
                variant="ghost"
                onClick={() => act.mutate(() => api.returnForChanges(c.ref, note))}
              >
                Return for changes
              </Button>
            </>
          ) : null}
        </div>
        <Refused r={act.data} />
      </section>
    </Card>
  );
}

// ── history ──────────────────────────────────────────────────────────────────────────────────
const ACTION: Record<string, string> = {
  submitted: "submitted for review",
  withdrawn: "withdrew it from review",
  approved: "approved",
  returned: "returned it",
};
function History({ c }: { c: AuthoredCourseDetail }) {
  const [open, setOpen] = useState<number | null>(null);
  const shown = c.versions.find((v) => v.version === open) ?? null;
  return (
    <Card>
      <section aria-label="History" className="space-y-2 text-sm">
        <h2 className="font-semibold">Publication history</h2>
        {c.versions.length === 0 ? <p className="text-muted">Never published.</p> : null}
        <ul className="space-y-1">
          {c.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">v{v.version}</span>
              <span className="text-muted">
                {formatCenterDate(v.publishedAt)} · {v.content.lessons.length} lessons · by{" "}
                {v.submittedBy} · approved by {v.approvedBy}
                {v.note ? ` — “${v.note}”` : ""}
              </span>
              <button
                type="button"
                className="text-xs text-brand underline"
                onClick={() => setOpen(open === v.version ? null : v.version)}
              >
                {open === v.version ? "Hide" : "View"} v{v.version}
              </button>
            </li>
          ))}
        </ul>
        {shown ? (
          <div
            aria-label={`Version ${shown.version}`}
            className="rounded-ogc border border-border p-2"
          >
            <ReadOnly content={shown.content} />
          </div>
        ) : null}
        <h2 className="pt-2 font-semibold">Review history</h2>
        <ul className="space-y-1 text-xs text-muted" aria-label="Review history">
          {c.reviews.map((r, i) => (
            <li key={i}>
              {formatCenterDateTime(r.at)} · {r.by} {ACTION[r.action]}
              {r.version ? ` → v${r.version}` : ""}
              {r.note ? ` — “${r.note}”` : ""}
            </li>
          ))}
        </ul>
      </section>
    </Card>
  );
}

function ReadOnly({ content }: { content: CourseContent }) {
  return (
    <div className="space-y-4">
      {content.summary ? <p className="text-sm text-muted">{content.summary}</p> : null}
      {content.lessons.map((l, i) => (
        <Card key={l.id}>
          <h2 className="mb-2 font-semibold">
            Lesson {i + 1} · {l.title}
          </h2>
          <LessonView blocks={l.blocks} />
        </Card>
      ))}
    </div>
  );
}

// ── editor ───────────────────────────────────────────────────────────────────────────────────
function Editor({ c }: { c: AuthoredCourseDetail }) {
  const api = useCourseStudioApi();
  const act = useAct();
  const [draft, setDraft] = useState<CourseContent>(c.draft);
  const [lessonIx, setLessonIx] = useState(0);
  const [preview, setPreview] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(c.draft);
  useEffect(() => {
    if (lessonIx >= draft.lessons.length) setLessonIx(Math.max(0, draft.lessons.length - 1));
  }, [draft.lessons.length, lessonIx]);
  const lesson = draft.lessons[lessonIx] ?? null;
  const draftIssue = contentIssue(draft, "draft");
  const submitIssue = contentIssue(draft, "submit");

  const setLesson = (ix: number, f: (l: CourseLesson) => CourseLesson) =>
    setDraft((d) => ({ ...d, lessons: d.lessons.map((l, i) => (i === ix ? f(l) : l)) }));
  const setBlock = (bix: number, b: CourseBlock) =>
    setLesson(lessonIx, (l) => ({ ...l, blocks: l.blocks.map((x, i) => (i === bix ? b : x)) }));
  const move = <T,>(list: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= list.length) return list;
    const out = [...list];
    const [x] = out.splice(from, 1);
    out.splice(to, 0, x);
    return out;
  };

  return (
    <Card>
      <section aria-label="Editor" className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
          <label>
            <span className="text-xs text-muted">Course title</span>
            <input
              aria-label="Course title"
              className={input}
              value={draft.title}
              maxLength={AUTHORING_LIMITS.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label>
            <span className="text-xs text-muted">Level</span>
            <input
              aria-label="Level"
              className={input}
              value={draft.level}
              maxLength={20}
              onChange={(e) => setDraft({ ...draft, level: e.target.value })}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs text-muted">Summary</span>
          <textarea
            aria-label="Summary"
            className={input}
            rows={2}
            value={draft.summary}
            maxLength={AUTHORING_LIMITS.summary}
            onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
          />
        </label>

        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <nav aria-label="Lessons" className="space-y-1">
            <ol className="space-y-1">
              {draft.lessons.map((l, i) => (
                <li key={l.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-current={i === lessonIx ? "true" : undefined}
                    className={`flex-1 truncate rounded-ogc px-2 py-1 text-left ${i === lessonIx ? "bg-surface font-medium" : ""}`}
                    onClick={() => setLessonIx(i)}
                  >
                    {i + 1}. {l.title || "Untitled lesson"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Move lesson ${i + 1} up`}
                    className="text-xs text-muted"
                    onClick={() => {
                      setDraft((d) => ({ ...d, lessons: move(d.lessons, i, i - 1) }));
                      if (i === lessonIx) setLessonIx(Math.max(0, i - 1));
                    }}
                  >
                    ↑
                  </button>
                </li>
              ))}
            </ol>
            <Button
              variant="ghost"
              disabled={draft.lessons.length >= AUTHORING_LIMITS.lessons}
              onClick={() => {
                setDraft((d) => ({
                  ...d,
                  lessons: [
                    ...d.lessons,
                    { id: newId("l"), title: `Lesson ${d.lessons.length + 1}`, blocks: [] },
                  ],
                }));
                setLessonIx(draft.lessons.length);
              }}
            >
              Add lesson
            </Button>
          </nav>

          {lesson ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex-1">
                  <span className="text-xs text-muted">Lesson title</span>
                  <input
                    aria-label="Lesson title"
                    className={input}
                    value={lesson.title}
                    maxLength={AUTHORING_LIMITS.title}
                    onChange={(e) => setLesson(lessonIx, (l) => ({ ...l, title: e.target.value }))}
                  />
                </label>
                <Button variant="ghost" onClick={() => setPreview((p) => !p)}>
                  {preview ? "Edit" : "Preview"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    setDraft((d) => ({ ...d, lessons: d.lessons.filter((_, i) => i !== lessonIx) }))
                  }
                >
                  Delete lesson
                </Button>
              </div>
              {preview ? (
                <div aria-label="Preview" className="rounded-ogc border border-border p-3">
                  <LessonView blocks={lesson.blocks} />
                </div>
              ) : (
                <ol className="space-y-2" aria-label="Blocks">
                  {lesson.blocks.map((b, bix) => (
                    <li key={b.id} className="rounded-ogc border border-border p-2">
                      <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                        <span className="font-medium uppercase">
                          {bix + 1}. {BLOCK_REGISTRY[b.kind].label}
                        </span>
                        <span className="flex-1" />
                        <button
                          type="button"
                          aria-label={`Move block ${bix + 1} up`}
                          onClick={() =>
                            setLesson(lessonIx, (l) => ({
                              ...l,
                              blocks: move(l.blocks, bix, bix - 1),
                            }))
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move block ${bix + 1} down`}
                          onClick={() =>
                            setLesson(lessonIx, (l) => ({
                              ...l,
                              blocks: move(l.blocks, bix, bix + 1),
                            }))
                          }
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete block ${bix + 1}`}
                          className="text-danger"
                          onClick={() =>
                            setLesson(lessonIx, (l) => ({
                              ...l,
                              blocks: l.blocks.filter((_, i) => i !== bix),
                            }))
                          }
                        >
                          ✕
                        </button>
                      </div>
                      <BlockFields b={b} n={bix + 1} onChange={(nb) => setBlock(bix, nb)} />
                    </li>
                  ))}
                </ol>
              )}
              <AddBlock
                disabled={lesson.blocks.length >= AUTHORING_LIMITS.blocksPerLesson}
                onAdd={(kind) =>
                  setLesson(lessonIx, (l) => ({
                    ...l,
                    blocks: [...l.blocks, BLOCK_REGISTRY[kind].make(newId(kind)) as CourseBlock],
                  }))
                }
              />
            </div>
          ) : (
            <p className="text-muted">No lessons yet — add one.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <Button
            disabled={!dirty || !!draftIssue || act.isPending}
            onClick={() => act.mutate(() => api.saveDraft(c.ref, draft, c.draftRevision))}
          >
            Save draft
          </Button>
          <Button
            variant="ghost"
            disabled={dirty || !!submitIssue || c.status === "published" || act.isPending}
            title={dirty ? "Save the draft first" : (submitIssue ?? undefined)}
            onClick={() => act.mutate(() => api.submit(c.ref))}
          >
            Submit for review
          </Button>
          <span className="text-xs text-muted" data-testid="draft-state">
            {dirty ? "Unsaved changes" : "Saved"} · revision {c.draftRevision}
            {draftIssue
              ? ` · ${draftIssue}`
              : submitIssue
                ? ` · before review: ${submitIssue}`
                : ""}
          </span>
        </div>
        <Refused r={act.data} />
      </section>
    </Card>
  );
}

function AddBlock({ onAdd, disabled }: { onAdd: (k: BlockKind) => void; disabled: boolean }) {
  const [kind, setKind] = useState<BlockKind>("text");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Block type"
        className="rounded-ogc border border-border bg-surface p-1"
        value={kind}
        onChange={(e) => setKind(e.target.value as BlockKind)}
      >
        {BLOCK_KINDS.map((k) => (
          <option key={k} value={k}>
            {BLOCK_REGISTRY[k].label}
          </option>
        ))}
      </select>
      <Button variant="ghost" disabled={disabled} onClick={() => onAdd(kind)}>
        Add block
      </Button>
      <span className="text-xs text-muted">{BLOCK_REGISTRY[kind].hint}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  long = false,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  long?: boolean;
  max: number;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted">{label.split(" · ")[0]}</span>
      {long ? (
        <textarea
          aria-label={label}
          className={input}
          rows={3}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          className={input}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function BlockFields({
  b,
  n,
  onChange,
}: {
  b: CourseBlock;
  n: number;
  onChange: (b: CourseBlock) => void;
}) {
  const L = AUTHORING_LIMITS;
  const at = (f: string) => `${f} · block ${n}`;
  switch (b.kind) {
    case "heading":
      return (
        <Field
          label={at("Heading")}
          value={b.text}
          max={L.shortText}
          onChange={(text) => onChange({ ...b, text })}
        />
      );
    case "text":
      return (
        <Field
          label={at("Text")}
          long
          value={b.text}
          max={L.longText}
          onChange={(text) => onChange({ ...b, text })}
        />
      );
    case "callout":
      return (
        <div className="space-y-1">
          <select
            aria-label={at("Tone")}
            className="rounded-ogc border border-border bg-surface p-1"
            value={b.tone}
            onChange={(e) => onChange({ ...b, tone: e.target.value as typeof b.tone })}
          >
            <option value="info">Note</option>
            <option value="tip">Tip</option>
            <option value="warning">Careful</option>
          </select>
          <Field
            label={at("Callout")}
            long
            value={b.text}
            max={L.longText}
            onChange={(text) => onChange({ ...b, text })}
          />
        </div>
      );
    case "divider":
      return <hr className="border-border" />;
    case "vocab":
      return (
        <div className="grid gap-1 sm:grid-cols-2">
          <Field
            label={at("Word")}
            value={b.word}
            max={60}
            onChange={(word) => onChange({ ...b, word })}
          />
          <Field
            label={at("Meaning")}
            value={b.meaning}
            max={L.shortText}
            onChange={(meaning) => onChange({ ...b, meaning })}
          />
          <Field
            label={at("Example sentence")}
            value={b.example}
            max={L.shortText}
            onChange={(example) => onChange({ ...b, example })}
          />
          <Field
            label={at("Translation")}
            value={b.translation}
            max={L.shortText}
            onChange={(translation) => onChange({ ...b, translation })}
          />
          <Field
            label={at("Image link (https)")}
            value={b.imageUrl}
            max={L.url}
            onChange={(imageUrl) => onChange({ ...b, imageUrl })}
          />
        </div>
      );
    case "quiz":
      return (
        <div className="space-y-1">
          <Field
            label={at("Question")}
            value={b.question}
            max={L.shortText}
            onChange={(question) => onChange({ ...b, question })}
          />
          <fieldset>
            <legend className="text-xs text-muted">Options — mark the correct one</legend>
            {b.options.map((o, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`correct-${b.id}`}
                  aria-label={`Correct option ${i + 1} · block ${n}`}
                  checked={b.correct === i}
                  onChange={() => onChange({ ...b, correct: i })}
                />
                <input
                  aria-label={`Option ${i + 1} · block ${n}`}
                  className={input}
                  value={o}
                  maxLength={120}
                  onChange={(e) =>
                    onChange({
                      ...b,
                      options: b.options.map((x, j) => (j === i ? e.target.value : x)),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remove option ${i + 1} · block ${n}`}
                  disabled={b.options.length <= L.optionsMin}
                  className="text-xs text-muted disabled:opacity-40"
                  onClick={() => {
                    const options = b.options.filter((_, j) => j !== i);
                    const correct = b.correct === i ? 0 : b.correct > i ? b.correct - 1 : b.correct;
                    onChange({ ...b, options, correct });
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </fieldset>
          <button
            type="button"
            className="text-xs text-brand disabled:opacity-40"
            disabled={b.options.length >= L.optionsMax}
            onClick={() => onChange({ ...b, options: [...b.options, ""] })}
          >
            + option · block {n}
          </button>
        </div>
      );
    case "video":
      return (
        <div className="grid gap-1 sm:grid-cols-2">
          <Field
            label={at("Video link (YouTube or Vimeo)")}
            value={b.url}
            max={L.url}
            onChange={(url) => onChange({ ...b, url })}
          />
          <Field
            label={at("Caption")}
            value={b.caption}
            max={L.shortText}
            onChange={(caption) => onChange({ ...b, caption })}
          />
        </div>
      );
    case "reflection":
      return (
        <Field
          label={at("Reflection question")}
          value={b.prompt}
          max={L.shortText}
          onChange={(prompt) => onChange({ ...b, prompt })}
        />
      );
  }
}
