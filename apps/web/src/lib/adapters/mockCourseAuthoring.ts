/*
 * Course Studio — courses OGC authors itself. MOCK adapter (SYNTHETIC). Owner decisions 22/11 (see
 * packages/contracts/src/authoring.ts): lessons of typed blocks; draft → submit → a different
 * person approves → immutable published version; edits after publishing are "unpublished
 * changes"; teachers edit their own courses, staff every course of their org (courses:author);
 * Org Admin / staff approve. The class-link flow (mockStudioLinks) and the learner player
 * (mockClassCoursePlayer) read published versions from here. No EduOS code or content.
 */
import type {
  AuthoredCourseDetail,
  AuthoredCourseSummary,
  AuthoredStatus,
  AuthoringResult,
  CourseAuthoringPort,
  CourseBlock,
  CourseContent,
  CourseLesson,
  CourseReviewEvent,
  CourseVersion,
  IiosGrantedContext,
} from "@ogc/contracts";
import { AUTHORING_LIMITS, contentIssue } from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";
import { TEACHER_BEN, TEACHER_TARA, teacherName } from "../../fixtures/personas";
import { allows } from "./accessPolicy";
import { displayNameOf, staffOrgOf, teacherIdOf } from "./viewer";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
type Refusal = Exclude<AuthoringResult, { ok: true }>;
const refuse = (reason: Refusal["reason"], detail?: string) =>
  latency<AuthoringResult>({ ok: false, reason, ...(detail ? { detail } : {}) });
const DAY = 86_400_000;

interface Person {
  id: string; // IIOS principal id — "a different person" is decided on this
  name: string;
}

export interface StoredCourse {
  ref: string;
  orgId: string;
  ownerTeacherId: string | null; // a teacher's own course; null = created by staff
  owner: Person;
  draft: CourseContent;
  revision: number;
  editors: Person[]; // who changed the draft since the last publication
  pending: { content: CourseContent; submittedBy: Person; submittedAt: string } | null;
  versions: CourseVersion[]; // oldest first; each content deep-frozen
  reviews: CourseReviewEvent[]; // oldest first
  updatedAt: string;
}

const courses = new Map<string, StoredCourse>();
let seq = 0;

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const same = (a: CourseContent, b: CourseContent) => JSON.stringify(a) === JSON.stringify(b);

// ── seed (synthetic content written for the demo) ───────────────────────────────────────────
const ORG = organizations[0].id;
const ORG2 = organizations[1].id;
const TARA: Person = { id: "iios-principal-teacher-1", name: "Tara (Teacher)" };
const BEN: Person = { id: "iios-principal-teacher-2", name: "Ben (Teacher)" };
const SAM: Person = { id: "iios-principal-staff-1", name: "Sam (Org Staff)" };
const OLIVIA: Person = { id: "iios-principal-admin-1", name: "Olivia (Org Admin)" };
const LUMEN: Person = { id: "iios-principal-staff-org2", name: "Staff (Lumen)" };

const A2_L1: CourseLesson = {
  id: "a2-l1",
  title: "At the market",
  blocks: [
    { id: "a2-l1-b1", kind: "heading", text: "Buying food at the market" },
    {
      id: "a2-l1-b2",
      kind: "text",
      text: "Listen to how Mai asks for prices. Notice the polite questions: “How much is…?” and “Can I have…?”",
    },
    // an older single vocabulary card — read as a deck of one (normalizeBlock)
    {
      id: "a2-l1-b3",
      kind: "vocab",
      word: "a kilo of",
      meaning: "one kilogram of something",
      example: "Can I have a kilo of mangoes, please?",
      translation: "một ký",
      imageUrl: "",
    } as unknown as CourseBlock,
    {
      id: "a2-l1-b4",
      kind: "quiz",
      question: "Which question is polite?",
      options: ["Give me rice.", "Can I have some rice, please?", "Rice now."],
      correct: 1,
    },
  ],
};
const A2_L2: CourseLesson = {
  id: "a2-l2",
  title: "Asking the way",
  blocks: [
    { id: "a2-l2-b1", kind: "heading", text: "Directions" },
    {
      id: "a2-l2-b2",
      kind: "callout",
      tone: "tip",
      text: "Use “Excuse me” before you ask a stranger a question.",
    },
    {
      id: "a2-l2-b3",
      kind: "quiz",
      question: "“Turn left” means…",
      options: ["go to the left", "go back", "stop"],
      correct: 0,
    },
    { id: "a2-l2-b4", kind: "reflection", prompt: "How do you get from your home to the center?" },
  ],
};
const A2_L3: CourseLesson = {
  id: "a2-l3",
  title: "Making plans",
  blocks: [
    { id: "a2-l3-b1", kind: "heading", text: "Are you free on Saturday?" },
    {
      id: "a2-l3-b2",
      kind: "video",
      url: "https://www.youtube.com/watch?v=ogc-demo-a2-plans",
      caption: "A short dialogue (synthetic demo link)",
    },
    { id: "a2-l3-b3", kind: "divider" },
    {
      id: "a2-l3-b4",
      kind: "quiz",
      question: "Choose the best answer: “Do you want to see a film?”",
      options: ["Yes, I'd love to.", "Yes, I love.", "I am film."],
      correct: 0,
    },
  ],
};
const A2_V1: CourseContent = clone<CourseContent>({
  title: "A2 Everyday English — Units 6–8",
  level: "A2",
  summary: "Shopping, directions and plans for the weekend.",
  lessons: [A2_L1, A2_L2],
});
const A2_V2: CourseContent = { ...clone(A2_V1), lessons: clone([A2_L1, A2_L2, A2_L3]) };

const B1_V1: CourseContent = clone<CourseContent>({
  title: "B1 Speaking Confidence",
  level: "B1",
  summary: "Give opinions, agree and disagree politely.",
  lessons: [
    {
      id: "b1-l1",
      title: "Giving opinions",
      blocks: [
        { id: "b1-l1-b1", kind: "heading", text: "In my opinion…" },
        {
          id: "b1-l1-b2",
          kind: "text",
          text: "Start with a phrase, give your opinion, then a reason.",
        },
        {
          id: "b1-l1-b3",
          kind: "quiz",
          question: "Which phrase gives an opinion?",
          options: ["I reckon…", "Goodbye…", "Excuse me…"],
          correct: 0,
        },
      ],
    },
    {
      id: "b1-l2",
      title: "Agreeing politely",
      blocks: [
        {
          id: "b1-l2-b1",
          kind: "callout",
          tone: "info",
          text: "“I see your point, but…” softens a disagreement.",
        },
        { id: "b1-l2-b2", kind: "reflection", prompt: "When did you last disagree with someone?" },
      ],
    },
  ],
});
const B1_DRAFT: CourseContent = {
  ...clone(B1_V1),
  lessons: [
    ...clone(B1_V1.lessons),
    {
      id: "b1-l3",
      title: "Short debates",
      blocks: [{ id: "b1-l3-b1", kind: "heading", text: "Two minutes each" }],
    },
  ],
};

const IELTS_V1: CourseContent = clone<CourseContent>({
  title: "IELTS Writing Task 1 — Charts",
  level: "IELTS",
  summary: "Describe trends in line and bar charts.",
  lessons: [
    {
      id: "iw-l1",
      title: "Trend words",
      blocks: [
        // an older single vocabulary card — read as a deck of one (normalizeBlock)
        {
          id: "iw-l1-b1",
          kind: "vocab",
          word: "to plateau",
          meaning: "to stay at the same level after rising",
          example: "Sales plateaued in the second half of the year.",
          translation: "chững lại",
          imageUrl: "",
        } as unknown as CourseBlock,
        {
          id: "iw-l1-b2",
          kind: "quiz",
          question: "A line that goes up quickly…",
          options: ["rises sharply", "falls slightly", "remains stable"],
          correct: 0,
        },
      ],
    },
    {
      id: "iw-l2",
      title: "Overview sentence",
      blocks: [
        { id: "iw-l2-b1", kind: "text", text: "Write one sentence that gives the main trend." },
        { id: "iw-l2-b2", kind: "reflection", prompt: "Write an overview of the sample chart." },
      ],
    },
  ],
});

const PHONICS: CourseContent = clone<CourseContent>({
  title: "A2 Pronunciation Lab",
  level: "A2",
  summary: "Word stress and the -ed ending.",
  lessons: [
    {
      id: "ph-l1",
      title: "The -ed ending",
      blocks: [
        { id: "ph-l1-b1", kind: "heading", text: "/t/, /d/ or /ɪd/?" },
        {
          id: "ph-l1-b2",
          kind: "quiz",
          question: "“wanted” ends with…",
          options: ["/t/", "/d/", "/ɪd/"],
          correct: 2,
        },
      ],
    },
  ],
});

const LUMEN_STARTER: CourseContent = clone<CourseContent>({
  title: "Lumen Starter English",
  level: "A1",
  summary: "Greetings and numbers.",
  lessons: [
    {
      id: "lu-l1",
      title: "Hello",
      blocks: [{ id: "lu-l1-b1", kind: "text", text: "Say hello and your name." }],
    },
  ],
});

function seed() {
  const now = Date.now();
  const at = (days: number) => new Date(now - days * DAY).toISOString();
  const v = (
    version: number,
    content: CourseContent,
    by: Person,
    approver: Person,
    days: number,
  ): CourseVersion => ({
    version,
    content: deepFreeze(clone(content)),
    submittedBy: by.name,
    approvedBy: approver.name,
    publishedAt: at(days),
    note: null,
  });
  const ev = (
    days: number,
    by: Person,
    action: CourseReviewEvent["action"],
    version: number | null = null,
    note: string | null = null,
  ): CourseReviewEvent => ({ at: at(days), by: by.name, action, version, note });
  const add = (c: StoredCourse) => courses.set(c.ref, c);

  add({
    ref: "CS-A2-EVERYDAY",
    orgId: ORG,
    ownerTeacherId: TEACHER_TARA,
    owner: TARA,
    draft: clone(A2_V2),
    revision: 6,
    editors: [],
    pending: null,
    versions: [v(1, A2_V1, TARA, SAM, 30), v(2, A2_V2, TARA, OLIVIA, 10)],
    reviews: [
      ev(31, TARA, "submitted"),
      ev(30, SAM, "approved", 1),
      ev(12, TARA, "submitted"),
      ev(11, OLIVIA, "returned", null, "Add a quiz to “Making plans”."),
      ev(10.5, TARA, "submitted"),
      ev(10, OLIVIA, "approved", 2),
    ],
    updatedAt: at(10),
  });
  add({
    ref: "CS-B1-SPEAK",
    orgId: ORG,
    ownerTeacherId: TEACHER_TARA,
    owner: TARA,
    draft: clone(B1_DRAFT),
    revision: 4,
    editors: [TARA],
    pending: null,
    versions: [v(1, B1_V1, TARA, SAM, 9)],
    reviews: [ev(10, TARA, "submitted"), ev(9, SAM, "approved", 1)],
    updatedAt: at(3),
  });
  add({
    ref: "CS-IELTS-W1",
    orgId: ORG,
    ownerTeacherId: null,
    owner: SAM,
    draft: clone(IELTS_V1),
    revision: 2,
    editors: [],
    pending: null,
    versions: [v(1, IELTS_V1, SAM, OLIVIA, 12)],
    reviews: [ev(13, SAM, "submitted"), ev(12, OLIVIA, "approved", 1)],
    updatedAt: at(12),
  });
  add({
    ref: "CS-A2-PHONICS",
    orgId: ORG,
    ownerTeacherId: TEACHER_BEN,
    owner: BEN,
    draft: clone(PHONICS),
    revision: 3,
    editors: [BEN],
    pending: { content: clone(PHONICS), submittedBy: BEN, submittedAt: at(1) },
    versions: [],
    reviews: [ev(1, BEN, "submitted")],
    updatedAt: at(1),
  });
  add({
    ref: "CS-LUMEN-STARTER",
    orgId: ORG2,
    ownerTeacherId: null,
    owner: LUMEN,
    draft: clone(LUMEN_STARTER),
    revision: 1,
    editors: [],
    pending: null,
    versions: [v(1, LUMEN_STARTER, LUMEN, LUMEN, 5)],
    reviews: [ev(5, LUMEN, "approved", 1)],
    updatedAt: at(5),
  });
}

function reset() {
  courses.clear();
  seq = 0;
  seed();
}
sessionStore.onReset(reset);
export const __resetCourseAuthoringForTests = reset;
registerPersistent("courseStudio", {
  dump: () => ({ courses, seq }),
  load: (raw) => {
    const r = raw as { courses?: unknown; seq?: number };
    refill(courses, r.courses);
    for (const c of courses.values()) for (const ver of c.versions) deepFreeze(ver);
    if (typeof r.seq === "number") seq = r.seq;
  },
});
reset();

// ── read helpers for the class-link flow and the learner player ─────────────────────────────
export function statusOf(c: StoredCourse): AuthoredStatus {
  if (c.pending) return "in_review";
  const last = c.versions[c.versions.length - 1];
  if (!last) return "draft";
  return same(last.content, c.draft) ? "published" : "unpublished_changes";
}
export const courseOf = (ref: string, orgId: string): StoredCourse | null => {
  const c = courses.get(ref);
  return c && c.orgId === orgId ? c : null;
};
export const latestVersion = (c: StoredCourse): CourseVersion | null =>
  c.versions[c.versions.length - 1] ?? null;
export const versionOf = (c: StoredCourse, n: number): CourseVersion | null =>
  c.versions.find((x) => x.version === n) ?? null;
export const coursesOfOrg = (orgId: string): StoredCourse[] =>
  [...courses.values()].filter((c) => c.orgId === orgId);

// ── rights ─────────────────────────────────────────────────────────────────────────────────
const me = (v: IiosGrantedContext): Person => ({ id: v.principalId, name: displayNameOf(v) });
const authors = (v: IiosGrantedContext) =>
  (!!staffOrgOf(v) || !!teacherIdOf(v)) && allows(v, "courses:author");

function canEdit(v: IiosGrantedContext, c: StoredCourse): boolean {
  if (c.orgId !== v.orgId || !authors(v)) return false;
  if (staffOrgOf(v)) return true;
  const t = teacherIdOf(v);
  return !!t && c.ownerTeacherId === t;
}
function canRead(v: IiosGrantedContext, c: StoredCourse): boolean {
  if (c.orgId !== v.orgId) return false;
  if (staffOrgOf(v)) return true;
  return !!teacherIdOf(v) && (canEdit(v, c) || c.versions.length > 0);
}
/** Why the viewer may NOT approve this course right now (null = may approve). */
function reviewBlock(v: IiosGrantedContext, c: StoredCourse): string | null {
  if (!c.pending) return "not in review";
  if (!staffOrgOf(v) || c.orgId !== v.orgId) return "Org Admin or center staff approve";
  if (!allows(v, "courses:author")) return "your access policy does not allow reviewing courses";
  if (c.pending.submittedBy.id === v.principalId) return "you submitted it — someone else approves";
  if (c.editors.some((e) => e.id === v.principalId))
    return "you edited this draft — someone else approves";
  return null;
}

function summary(v: IiosGrantedContext, c: StoredCourse): AuthoredCourseSummary {
  const last = latestVersion(c);
  return {
    ref: c.ref,
    title: c.draft.title,
    level: c.draft.level,
    ownerName: c.ownerTeacherId ? (teacherName(c.ownerTeacherId) ?? c.owner.name) : c.owner.name,
    status: statusOf(c),
    lessons: last?.content.lessons.length ?? 0,
    publishedVersion: last?.version ?? null,
    updatedAt: c.updatedAt,
    canEdit: canEdit(v, c),
    canReview: reviewBlock(v, c) === null,
  };
}

let linkedClassesOf: (ref: string) => string[] = () => [];
/** mockStudioLinks registers how to name the classes following a course (avoids an import cycle). */
export function __setLinkedClassesLookup(f: (ref: string) => string[]) {
  linkedClassesOf = f;
}

function detail(v: IiosGrantedContext, c: StoredCourse): AuthoredCourseDetail {
  const editable = canEdit(v, c);
  return {
    ...summary(v, c),
    // A teacher who only reads someone else's course sees the published version, not the draft.
    draft: clone(editable || staffOrgOf(v) ? c.draft : (latestVersion(c)?.content ?? c.draft)),
    draftRevision: c.revision,
    pending:
      c.pending && (editable || staffOrgOf(v))
        ? {
            content: clone(c.pending.content),
            submittedBy: c.pending.submittedBy.name,
            submittedAt: c.pending.submittedAt,
          }
        : null,
    editorsSinceLastPublication: c.editors.map((e) => e.name),
    versions: [...c.versions].reverse(),
    reviews: [...c.reviews].reverse(),
    linkedClasses: linkedClassesOf(c.ref),
    reviewBlockedReason: c.pending ? reviewBlock(v, c) : null,
  };
}

const noteIssue = (note: string, required: boolean): string | null => {
  const n = note.trim();
  if (required && n.length < 3) return "give a note (3–300 characters)";
  return n.length > AUTHORING_LIMITS.note ? "the note is too long (max 300)" : null;
};

// ── port ────────────────────────────────────────────────────────────────────────────────────
export const mockCourseAuthoring: CourseAuthoringPort = {
  list: (viewer) =>
    withFault("courses.list", () => {
      if (!staffOrgOf(viewer) && !teacherIdOf(viewer)) return latency(null);
      return latency({
        courses: coursesOfOrg(viewer.orgId)
          .filter((c) => canRead(viewer, c))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((c) => summary(viewer, c)),
        canCreate: authors(viewer),
      });
    }),

  get: (viewer, ref) =>
    withFault("courses.get", () => {
      const c = courseOf(ref, viewer.orgId);
      return latency(c && canRead(viewer, c) ? detail(viewer, c) : null);
    }),

  create: (viewer, title, level) =>
    withFault("courses.create", () => {
      if (!staffOrgOf(viewer) && !teacherIdOf(viewer))
        return refuse("not_allowed", "teachers and center staff write courses");
      if (!authors(viewer)) return refuse("access_policy");
      const content: CourseContent = {
        title: title.trim(),
        level: level.trim(),
        summary: "",
        lessons: [{ id: "l1", title: "Lesson 1", blocks: [] }],
      };
      const issue = contentIssue(content, "draft");
      if (issue) return refuse("invalid", issue);
      const ref = `CS-${String(++seq).padStart(3, "0")}`;
      const now = new Date().toISOString();
      courses.set(ref, {
        ref,
        orgId: viewer.orgId,
        ownerTeacherId: teacherIdOf(viewer),
        owner: me(viewer),
        draft: content,
        revision: 1,
        editors: [me(viewer)],
        pending: null,
        versions: [],
        reviews: [],
        updatedAt: now,
      });
      return latency<AuthoringResult>({ ok: true, ref, revision: 1 });
    }),

  saveDraft: (viewer, ref, content, baseRevision) =>
    withFault("courses.save", () => {
      const c = courseOf(ref, viewer.orgId);
      if (!c || !canRead(viewer, c)) return refuse("not_found");
      if (!canEdit(viewer, c))
        return authors(viewer)
          ? refuse("not_allowed", "a teacher edits their own courses")
          : refuse("access_policy");
      if (c.pending) return refuse("invalid_step", "in review — withdraw it to edit");
      if (baseRevision !== c.revision)
        return refuse("conflict", "someone saved a newer draft — reload to see it");
      const issue = contentIssue(content, "draft");
      if (issue) return refuse("invalid", issue);
      const next = clone(content);
      if (same(next, c.draft)) return latency<AuthoringResult>({ ok: true, revision: c.revision });
      c.draft = next;
      c.revision += 1;
      c.updatedAt = new Date().toISOString();
      if (!c.editors.some((e) => e.id === viewer.principalId)) c.editors.push(me(viewer));
      return latency<AuthoringResult>({ ok: true, revision: c.revision });
    }),

  submit: (viewer, ref) =>
    withFault("courses.submit", () => {
      const c = courseOf(ref, viewer.orgId);
      if (!c || !canRead(viewer, c)) return refuse("not_found");
      if (!canEdit(viewer, c)) return refuse("not_allowed");
      if (c.pending) return refuse("invalid_step", "already in review");
      const last = latestVersion(c);
      if (last && same(last.content, c.draft))
        return refuse("invalid_step", "nothing changed since the last publication");
      const issue = contentIssue(c.draft, "submit");
      if (issue) return refuse("invalid", issue);
      const now = new Date().toISOString();
      c.pending = { content: clone(c.draft), submittedBy: me(viewer), submittedAt: now };
      c.reviews.push({
        at: now,
        by: me(viewer).name,
        action: "submitted",
        version: null,
        note: null,
      });
      c.updatedAt = now;
      return latency<AuthoringResult>({ ok: true });
    }),

  withdraw: (viewer, ref) =>
    withFault("courses.withdraw", () => {
      const c = courseOf(ref, viewer.orgId);
      if (!c || !canRead(viewer, c)) return refuse("not_found");
      if (!canEdit(viewer, c)) return refuse("not_allowed");
      if (!c.pending) return refuse("invalid_step", "not in review");
      const now = new Date().toISOString();
      c.pending = null;
      c.reviews.push({
        at: now,
        by: me(viewer).name,
        action: "withdrawn",
        version: null,
        note: null,
      });
      c.updatedAt = now;
      return latency<AuthoringResult>({ ok: true });
    }),

  approve: (viewer, ref, note) =>
    withFault("courses.approve", () => {
      const c = courseOf(ref, viewer.orgId);
      if (!c || !canRead(viewer, c)) return refuse("not_found");
      if (!c.pending) return refuse("invalid_step", "not in review");
      const block = reviewBlock(viewer, c);
      if (block)
        return block.startsWith("you ")
          ? refuse("own_step", block)
          : block.startsWith("your access")
            ? refuse("access_policy")
            : refuse("not_allowed", block);
      const n = noteIssue(note, false);
      if (n) return refuse("invalid", n);
      const issue = contentIssue(c.pending.content, "submit");
      if (issue) return refuse("invalid", issue); // fail-closed even if the rules tightened
      const now = new Date().toISOString();
      const version = (latestVersion(c)?.version ?? 0) + 1;
      c.versions.push({
        version,
        content: deepFreeze(clone(c.pending.content)),
        submittedBy: c.pending.submittedBy.name,
        approvedBy: me(viewer).name,
        publishedAt: now,
        note: note.trim() || null,
      });
      c.reviews.push({
        at: now,
        by: me(viewer).name,
        action: "approved",
        version,
        note: note.trim() || null,
      });
      c.pending = null;
      c.editors = [];
      c.updatedAt = now;
      return latency<AuthoringResult>({ ok: true });
    }),

  returnForChanges: (viewer, ref, note) =>
    withFault("courses.return", () => {
      const c = courseOf(ref, viewer.orgId);
      if (!c || !canRead(viewer, c)) return refuse("not_found");
      if (!c.pending) return refuse("invalid_step", "not in review");
      const block = reviewBlock(viewer, c);
      if (block)
        return block.startsWith("you ")
          ? refuse("own_step", block)
          : block.startsWith("your access")
            ? refuse("access_policy")
            : refuse("not_allowed", block);
      const n = noteIssue(note, true);
      if (n) return refuse("invalid", n);
      const now = new Date().toISOString();
      c.pending = null;
      c.reviews.push({
        at: now,
        by: me(viewer).name,
        action: "returned",
        version: null,
        note: note.trim(),
      });
      c.updatedAt = now;
      return latency<AuthoringResult>({ ok: true });
    }),
};
