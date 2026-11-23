import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Course Studio — courses OGC authors itself. ADDITIVE, SYNTHETIC, mock only. Owner decisions
 * 22/11 (replacing the Learning Studio link of #63; EduOS is a separate product, IIOS does not
 * exist yet — nothing here talks to either, and no EduOS code is copied: only the editor
 * pattern of lessons made of typed blocks is imitated):
 *  - a course is lessons, a lesson is an ordered list of BLOCKS. Slice 1 blocks: heading, text,
 *    callout, divider, vocabulary card (word, meaning, example, translation, image link),
 *    multiple-choice quiz, video link, reflection. Text is plain text, never HTML;
 *  - every block kind is in BLOCK_REGISTRY; anything else is refused (fail-closed);
 *  - workflow: draft → submit for review → a DIFFERENT person approves → an immutable published
 *    version (v1, v2, …). Edits after publishing are "unpublished changes" until the next
 *    approval. Publication history and review history are kept;
 *  - teachers and staff author (courses:author): a teacher edits their own courses, staff edit
 *    every course of their org. Org Admin / staff (courses:author) approve — never the person
 *    who submitted, nor anyone who edited the draft since the last publication;
 *  - learners learn the course linked to their class in My Learning, PINNED to the version they
 *    started; a quiz score is assessed evidence for the skill profile (use of English).
 */

// ── Blocks ──────────────────────────────────────────────────────────────────────────────────
export type BlockKind =
  | "heading"
  | "text"
  | "callout"
  | "divider"
  | "vocab"
  | "quiz"
  | "video"
  | "reflection"
  | "speaking";

/** One turn of a speaking rehearsal: the coach's line, the replies to choose from (one is the
 *  natural one), a model line and a pronunciation / usage tip shown after submitting. */
export interface SpeakingTurn {
  coach: string;
  options: string[];
  natural: number;
  model: string;
  tip: string;
}

export type CalloutTone = "info" | "tip" | "warning";

export type CourseBlock =
  | { id: string; kind: "heading"; text: string }
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "callout"; tone: CalloutTone; text: string }
  | { id: string; kind: "divider" }
  | {
      id: string;
      kind: "vocab";
      word: string;
      meaning: string;
      example: string;
      translation: string;
      imageUrl: string;
    }
  | { id: string; kind: "quiz"; question: string; options: string[]; correct: number }
  | { id: string; kind: "video"; url: string; caption: string }
  | { id: string; kind: "reflection"; prompt: string }
  | { id: string; kind: "speaking"; scenario: string; turns: SpeakingTurn[] };

export type BlockOf<K extends BlockKind> = Extract<CourseBlock, { kind: K }>;

export const AUTHORING_LIMITS = {
  title: 120,
  summary: 400,
  lessons: 20,
  blocksPerLesson: 40,
  shortText: 160,
  longText: 2000,
  optionsMin: 2,
  optionsMax: 6,
  url: 300,
  reflectionAnswer: 1000,
  speakingTurnsMax: 8,
  speakingOptionsMax: 4,
  note: 300,
} as const;

/** Hosts a video link may point to. The link opens in a new tab — OGC never embeds it. */
export const VIDEO_HOSTS = ["youtube.com", "www.youtube.com", "youtu.be", "vimeo.com"];

export interface BlockSpec<K extends BlockKind> {
  kind: K;
  label: string;
  hint: string;
  make: (id: string) => BlockOf<K>;
}

export const BLOCK_REGISTRY: { [K in BlockKind]: BlockSpec<K> } = {
  heading: {
    kind: "heading",
    label: "Heading",
    hint: "A section title",
    make: (id) => ({ id, kind: "heading", text: "" }),
  },
  text: {
    kind: "text",
    label: "Text",
    hint: "A paragraph (plain text)",
    make: (id) => ({ id, kind: "text", text: "" }),
  },
  callout: {
    kind: "callout",
    label: "Callout",
    hint: "A highlighted note, tip or warning",
    make: (id) => ({ id, kind: "callout", tone: "tip", text: "" }),
  },
  divider: {
    kind: "divider",
    label: "Divider",
    hint: "A line between parts",
    make: (id) => ({ id, kind: "divider" }),
  },
  vocab: {
    kind: "vocab",
    label: "Vocabulary card",
    hint: "Word, meaning, example, translation, image link",
    make: (id) => ({
      id,
      kind: "vocab",
      word: "",
      meaning: "",
      example: "",
      translation: "",
      imageUrl: "",
    }),
  },
  quiz: {
    kind: "quiz",
    label: "Quiz (multiple choice)",
    hint: "One question, one correct option — scored into the skill profile",
    make: (id) => ({ id, kind: "quiz", question: "", options: ["", ""], correct: 0 }),
  },
  video: {
    kind: "video",
    label: "Video (link)",
    hint: "A YouTube or Vimeo link, opened in a new tab",
    make: (id) => ({ id, kind: "video", url: "", caption: "" }),
  },
  reflection: {
    kind: "reflection",
    label: "Reflection",
    hint: "A question the learner answers in their own words (not scored)",
    make: (id) => ({ id, kind: "reflection", prompt: "" }),
  },
  speaking: {
    kind: "speaking",
    label: "Speaking rehearsal",
    hint: "A role-play: the learner picks and says the natural reply; counts for Speaking only after the class teacher approves it",
    make: (id) => ({
      id,
      kind: "speaking",
      scenario: "",
      turns: [{ coach: "", options: ["", ""], natural: 0, model: "", tip: "" }],
    }),
  },
};
export const BLOCK_KINDS = Object.keys(BLOCK_REGISTRY) as BlockKind[];

export interface CourseLesson {
  id: string;
  title: string;
  blocks: CourseBlock[];
}

export interface CourseContent {
  title: string;
  level: string; // free label, e.g. "A2", "B1", "IELTS"
  summary: string;
  lessons: CourseLesson[];
}

// ── Validation (pure, fail-closed) ─────────────────────────────────────────────────────────
// "draft": the shape must be right and within limits (empty fields allowed while writing).
// "submit": additionally every required field is filled — what a reviewer will see.
export type ValidationMode = "draft" | "submit";

const isStr = (x: unknown): x is string => typeof x === "string";
const tooLong = (s: string, max: number) => s.length > max;

export function urlIssue(url: string, hosts: string[] | null): string | null {
  if (url === "") return null;
  if (tooLong(url, AUTHORING_LIMITS.url)) return "the link is too long";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "not a valid link";
  }
  if (u.protocol !== "https:") return "links must start with https://";
  if (u.username || u.password) return "links cannot carry a user name or password";
  if (hosts && !hosts.includes(u.hostname)) return `only ${hosts.join(", ")}`;
  return null;
}

export function blockIssue(b: unknown, mode: ValidationMode): string | null {
  if (!b || typeof b !== "object") return "not a block";
  const x = b as Record<string, unknown>;
  if (!isStr(x.id) || !x.id) return "block without an id";
  if (!isStr(x.kind) || !(x.kind in BLOCK_REGISTRY)) return `unknown block kind`;
  const kind = x.kind as BlockKind;
  const label = BLOCK_REGISTRY[kind].label;
  const allowed: Record<BlockKind, string[]> = {
    heading: ["text"],
    text: ["text"],
    callout: ["tone", "text"],
    divider: [],
    vocab: ["word", "meaning", "example", "translation", "imageUrl"],
    quiz: ["question", "options", "correct"],
    video: ["url", "caption"],
    reflection: ["prompt"],
    speaking: ["scenario", "turns"],
  };
  for (const k of Object.keys(x))
    if (k !== "id" && k !== "kind" && !allowed[kind].includes(k)) return `${label}: unknown field`;
  const need = (field: string, max: number): string | null => {
    const v = x[field];
    if (!isStr(v)) return `${label}: ${field} is missing`;
    if (tooLong(v, max)) return `${label}: ${field} is too long (max ${max})`;
    if (mode === "submit" && v.trim() === "") return `${label}: ${field} is empty`;
    return null;
  };
  const opt = (field: string, max: number): string | null => {
    const v = x[field];
    if (!isStr(v)) return `${label}: ${field} is missing`;
    return tooLong(v, max) ? `${label}: ${field} is too long (max ${max})` : null;
  };
  switch (kind) {
    case "heading":
      return need("text", AUTHORING_LIMITS.shortText);
    case "text":
      return need("text", AUTHORING_LIMITS.longText);
    case "callout":
      if (!["info", "tip", "warning"].includes(x.tone as string)) return `${label}: unknown tone`;
      return need("text", AUTHORING_LIMITS.longText);
    case "divider":
      return null;
    case "vocab": {
      const e =
        need("word", 60) ??
        need("meaning", AUTHORING_LIMITS.shortText) ??
        opt("example", AUTHORING_LIMITS.shortText) ??
        opt("translation", AUTHORING_LIMITS.shortText) ??
        opt("imageUrl", AUTHORING_LIMITS.url);
      if (e) return e;
      const u = urlIssue(x.imageUrl as string, null);
      return u ? `${label}: image ${u}` : null;
    }
    case "quiz": {
      const e = need("question", AUTHORING_LIMITS.shortText);
      if (e) return e;
      const o = x.options;
      if (!Array.isArray(o) || !o.every(isStr)) return `${label}: options are missing`;
      if (o.length < AUTHORING_LIMITS.optionsMin || o.length > AUTHORING_LIMITS.optionsMax)
        return `${label}: ${AUTHORING_LIMITS.optionsMin}–${AUTHORING_LIMITS.optionsMax} options`;
      if (o.some((s) => tooLong(s, 120))) return `${label}: an option is too long (max 120)`;
      if (
        !Number.isInteger(x.correct) ||
        (x.correct as number) < 0 ||
        (x.correct as number) >= o.length
      )
        return `${label}: pick the correct option`;
      if (mode === "submit") {
        if (o.some((s) => s.trim() === "")) return `${label}: an option is empty`;
        if (new Set(o.map((s) => s.trim().toLowerCase())).size !== o.length)
          return `${label}: two options are the same`;
      }
      return null;
    }
    case "video": {
      const e = need("url", AUTHORING_LIMITS.url) ?? opt("caption", AUTHORING_LIMITS.shortText);
      if (e) return e;
      const u = urlIssue(x.url as string, VIDEO_HOSTS);
      return u ? `${label}: ${u}` : null;
    }
    case "reflection":
      return need("prompt", AUTHORING_LIMITS.shortText);
    case "speaking": {
      const e = need("scenario", AUTHORING_LIMITS.shortText);
      if (e) return e;
      const turns = x.turns;
      if (
        !Array.isArray(turns) ||
        turns.length < 1 ||
        turns.length > AUTHORING_LIMITS.speakingTurnsMax
      )
        return `${label}: 1–${AUTHORING_LIMITS.speakingTurnsMax} turns`;
      for (const [i, t] of (turns as unknown[]).entries()) {
        const n = `${label}, turn ${i + 1}`;
        if (!t || typeof t !== "object") return `${n}: not a turn`;
        const tt = t as Record<string, unknown>;
        for (const k of Object.keys(tt))
          if (!["coach", "options", "natural", "model", "tip"].includes(k))
            return `${n}: unknown field`;
        for (const f of ["coach", "model", "tip"]) {
          const v = tt[f];
          if (!isStr(v)) return `${n}: ${f} is missing`;
          if (tooLong(v, AUTHORING_LIMITS.shortText))
            return `${n}: ${f} is too long (max ${AUTHORING_LIMITS.shortText})`;
          if (mode === "submit" && f !== "tip" && v.trim() === "") return `${n}: ${f} is empty`;
        }
        const o = tt.options;
        if (!Array.isArray(o) || !o.every(isStr)) return `${n}: options are missing`;
        if (o.length < 2 || o.length > AUTHORING_LIMITS.speakingOptionsMax)
          return `${n}: 2–${AUTHORING_LIMITS.speakingOptionsMax} replies`;
        if (o.some((s) => tooLong(s, 120))) return `${n}: a reply is too long (max 120)`;
        if (
          !Number.isInteger(tt.natural) ||
          (tt.natural as number) < 0 ||
          (tt.natural as number) >= o.length
        )
          return `${n}: pick the natural reply`;
        if (mode === "submit") {
          if (o.some((s) => s.trim() === "")) return `${n}: a reply is empty`;
          if (new Set(o.map((s) => s.trim().toLowerCase())).size !== o.length)
            return `${n}: two replies are the same`;
        }
      }
      return null;
    }
  }
}

export function contentIssue(c: unknown, mode: ValidationMode): string | null {
  if (!c || typeof c !== "object") return "not a course";
  const x = c as Record<string, unknown>;
  if (!isStr(x.title) || x.title.trim().length < 3 || tooLong(x.title, AUTHORING_LIMITS.title))
    return `course title: 3–${AUTHORING_LIMITS.title} characters`;
  if (!isStr(x.level) || tooLong(x.level, 20)) return "level: up to 20 characters";
  if (!isStr(x.summary) || tooLong(x.summary, AUTHORING_LIMITS.summary))
    return `summary: up to ${AUTHORING_LIMITS.summary} characters`;
  if (!Array.isArray(x.lessons)) return "lessons are missing";
  if (x.lessons.length > AUTHORING_LIMITS.lessons)
    return `at most ${AUTHORING_LIMITS.lessons} lessons`;
  if (mode === "submit" && x.lessons.length === 0) return "add at least one lesson";
  const lessonIds = new Set<string>();
  const blockIds = new Set<string>();
  for (const [i, l] of (x.lessons as unknown[]).entries()) {
    const n = `lesson ${i + 1}`;
    if (!l || typeof l !== "object") return `${n}: not a lesson`;
    const ll = l as Record<string, unknown>;
    if (!isStr(ll.id) || !ll.id || lessonIds.has(ll.id)) return `${n}: bad id`;
    lessonIds.add(ll.id);
    if (!isStr(ll.title) || tooLong(ll.title, AUTHORING_LIMITS.title))
      return `${n}: title too long`;
    if (mode === "submit" && ll.title.trim() === "") return `${n}: give it a title`;
    if (!Array.isArray(ll.blocks)) return `${n}: blocks are missing`;
    if (ll.blocks.length > AUTHORING_LIMITS.blocksPerLesson)
      return `${n}: at most ${AUTHORING_LIMITS.blocksPerLesson} blocks`;
    if (mode === "submit" && ll.blocks.length === 0) return `${n}: add at least one block`;
    for (const [j, b] of (ll.blocks as unknown[]).entries()) {
      const e = blockIssue(b, mode);
      if (e) return `${n}, block ${j + 1}: ${e}`;
      const id = (b as { id: string }).id;
      if (blockIds.has(id)) return `${n}, block ${j + 1}: duplicate id`;
      blockIds.add(id);
    }
  }
  return null;
}

/** Quiz score of one lesson: % of its quiz blocks answered correctly, or null without quizzes. */
export function lessonQuizScore(
  lesson: CourseLesson,
  answers: Record<string, number>,
): number | null {
  const quizzes = lesson.blocks.filter((b): b is BlockOf<"quiz"> => b.kind === "quiz");
  if (quizzes.length === 0) return null;
  const right = quizzes.filter((q) => answers[q.id] === q.correct).length;
  return Math.round((right / quizzes.length) * 100);
}

/** A speaking rehearsal's score: % of turns where the learner picked the natural reply. */
export function speakingScore(block: BlockOf<"speaking">, choices: readonly number[]): number {
  const right = block.turns.filter((t, i) => choices[i] === t.natural).length;
  return Math.round((right / block.turns.length) * 100);
}

/** Before a lesson is completed the learner must not see the answers: quiz `correct` and a
 *  speaking turn's natural reply become -1, its model line and tip are blanked. */
export function hideLessonAnswers(l: CourseLesson): CourseLesson {
  return {
    ...l,
    blocks: l.blocks.map((b) =>
      b.kind === "quiz"
        ? { ...b, correct: -1 }
        : b.kind === "speaking"
          ? { ...b, turns: b.turns.map((t) => ({ ...t, natural: -1, model: "", tip: "" })) }
          : b,
    ),
  };
}

// ── Course, versions, reviews ──────────────────────────────────────────────────────────────
export type AuthoredStatus = "draft" | "in_review" | "published" | "unpublished_changes";

export interface CourseVersion {
  version: number;
  content: CourseContent; // immutable once published
  submittedBy: string;
  approvedBy: string;
  publishedAt: string;
  note: string | null;
}

export type CourseReviewAction = "submitted" | "withdrawn" | "approved" | "returned";
export interface CourseReviewEvent {
  at: string;
  by: string;
  action: CourseReviewAction;
  version: number | null; // the version an approval published
  note: string | null;
}

export interface AuthoredCourseSummary {
  ref: string;
  title: string;
  level: string;
  ownerName: string;
  status: AuthoredStatus;
  lessons: number; // of the latest published version (0 when never published)
  publishedVersion: number | null;
  updatedAt: string;
  canEdit: boolean;
  canReview: boolean; // in review and the viewer may approve / return it
}

export interface AuthoredCourseDetail extends AuthoredCourseSummary {
  draft: CourseContent;
  draftRevision: number; // optimistic concurrency for saves
  pending: { content: CourseContent; submittedBy: string; submittedAt: string } | null;
  editorsSinceLastPublication: string[];
  versions: CourseVersion[]; // newest first
  reviews: CourseReviewEvent[]; // newest first
  linkedClasses: string[]; // class names following it
  reviewBlockedReason: string | null; // why the viewer may not approve, when in review
}

export type AuthoringRefusal =
  | "not_allowed"
  | "not_found"
  | "invalid"
  | "invalid_step"
  | "conflict"
  | "own_step"
  | "access_policy";
export type AuthoringResult =
  | { ok: true; ref?: string; revision?: number }
  | { ok: false; reason: AuthoringRefusal; detail?: string };

export interface CourseAuthoringPort {
  // Teachers: own courses + published courses of their org (read-only). Staff: their org.
  list(
    viewer: IiosGrantedContext,
  ): Promise<{ courses: AuthoredCourseSummary[]; canCreate: boolean } | null>;
  get(viewer: IiosGrantedContext, ref: string): Promise<AuthoredCourseDetail | null>;
  create(viewer: IiosGrantedContext, title: string, level: string): Promise<AuthoringResult>;
  saveDraft(
    viewer: IiosGrantedContext,
    ref: string,
    content: CourseContent,
    baseRevision: number,
  ): Promise<AuthoringResult>;
  submit(viewer: IiosGrantedContext, ref: string): Promise<AuthoringResult>;
  withdraw(viewer: IiosGrantedContext, ref: string): Promise<AuthoringResult>;
  approve(viewer: IiosGrantedContext, ref: string, note: string): Promise<AuthoringResult>;
  returnForChanges(viewer: IiosGrantedContext, ref: string, note: string): Promise<AuthoringResult>;
}

// ── Learner side (My Learning) ─────────────────────────────────────────────────────────────
export interface LearnerLessonState {
  lessonId: string;
  title: string;
  completedAt: string | null;
  score: number | null; // quiz %, null without quizzes or not done
}

export interface MyClassCourse {
  ref: string;
  className: string;
  title: string;
  summary: string;
  version: number; // the pinned version
  latestVersion: number;
  lessons: LearnerLessonState[];
  completedLessons: number;
  pct: number;
}

export interface MyLessonView {
  ref: string;
  version: number;
  lesson: CourseLesson; // quiz `correct` is stripped until the lesson is completed (−1)
  index: number;
  total: number;
  completed: {
    at: string;
    score: number | null;
    answers: Record<string, number>;
    reflections: Record<string, string>;
    speaking?: Record<string, number[]>; // speaking block → the reply chosen at each turn
  } | null;
  /** Speaking rehearsals of this lesson (Platform): the latest attempt per speaking block. */
  speaking?: SpeakingAttemptView[];
}

export type SpeakingAttemptStatus = "pending" | "approved" | "returned";
export interface SpeakingAttemptView {
  blockId: string;
  attempt: number; // 1, 2, … (a returned rehearsal may be tried again)
  choices: number[];
  score: number; // % natural replies — counts for Speaking only once approved
  status: SpeakingAttemptStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewerName: string | null;
  note: string | null; // the class teacher's note when returned
}

/** A rehearsal waiting for the class teacher (Platform). */
export interface CourseSpeakingReviewItem {
  learnerId: string;
  learnerName: string;
  className: string;
  ref: string;
  courseTitle: string;
  version: number;
  lessonId: string;
  lessonTitle: string;
  blockId: string;
  attempt: number;
  scenario: string;
  score: number;
  submittedAt: string;
  turns: { coach: string; chosen: string | null; model: string; natural: boolean }[];
}
/** The speaking review queue: the class teacher reviews; center staff only see it. */
export interface SpeakingReviewQueue {
  items: CourseSpeakingReviewItem[];
  mayReview: boolean;
}

export interface ClassCoursePlayerPort {
  mine(viewer: IiosGrantedContext): Promise<MyClassCourse[] | null>;
  lesson(viewer: IiosGrantedContext, ref: string, lessonId: string): Promise<MyLessonView | null>;
  complete(
    viewer: IiosGrantedContext,
    ref: string,
    lessonId: string,
    answers: Record<string, number>,
    reflections: Record<string, string>,
    speaking?: Record<string, number[]>, // speaking block id → the reply chosen at each turn
  ): Promise<AuthoringResult & { score?: number | null }>;
}
