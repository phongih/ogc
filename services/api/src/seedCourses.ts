/*
 * Course Studio sample courses — the demo's synthetic content (apps/web/src/lib/adapters/
 * mockCourseAuthoring.ts), dated relative to `now`. No EduOS content.
 *  - CS-A2-EVERYDAY (Tara): v1, v2 published (one return in between);
 *  - CS-B1-SPEAK (Tara): v1 published, a third lesson as unpublished changes;
 *  - CS-IELTS-W1 (Sam, staff): v1 published;
 *  - CS-A2-PHONICS (Ben): submitted, never published — waiting for a reviewer;
 *  - CS-LUMEN-STARTER (the second tenant): v1 published.
 */
import type pg from "pg";
import type { CourseContent, CourseLesson } from "@ogc/contracts";

const DAY = 86_400_000;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

interface Person {
  id: string;
  name: string;
}
export const COURSE_PEOPLE = {
  tara: { id: "iios-principal-teacher-1", name: "Tara" },
  ben: { id: "iios-principal-teacher-2", name: "Ben" },
  sam: { id: "iios-principal-staff-1", name: "Sam (Org Staff)" },
  olivia: { id: "iios-principal-admin-1", name: "Olivia (Org Admin)" },
  lumen: { id: "iios-principal-staff-org2", name: "Staff (Lumen)" },
} satisfies Record<string, Person>;

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
    {
      id: "a2-l1-b3",
      kind: "vocab",
      word: "a kilo of",
      meaning: "one kilogram of something",
      example: "Can I have a kilo of mangoes, please?",
      translation: "một ký",
      imageUrl: "",
    },
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
const A2_V1: CourseContent = {
  title: "A2 Everyday English — Units 6–8",
  level: "A2",
  summary: "Shopping, directions and plans for the weekend.",
  lessons: [A2_L1, A2_L2],
};
const A2_V2: CourseContent = { ...A2_V1, lessons: [A2_L1, A2_L2, A2_L3] };

const B1_V1: CourseContent = {
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
};
const B1_DRAFT: CourseContent = {
  ...B1_V1,
  lessons: [
    ...B1_V1.lessons,
    {
      id: "b1-l3",
      title: "Short debates",
      blocks: [{ id: "b1-l3-b1", kind: "heading", text: "Two minutes each" }],
    },
  ],
};

const IELTS_V1: CourseContent = {
  title: "IELTS Writing Task 1 — Charts",
  level: "IELTS",
  summary: "Describe trends in line and bar charts.",
  lessons: [
    {
      id: "iw-l1",
      title: "Trend words",
      blocks: [
        {
          id: "iw-l1-b1",
          kind: "vocab",
          word: "to plateau",
          meaning: "to stay at the same level after rising",
          example: "Sales plateaued in the second half of the year.",
          translation: "chững lại",
          imageUrl: "",
        },
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
};

const PHONICS: CourseContent = {
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
};

export const LUMEN_STARTER: CourseContent = {
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
};

interface SeedCourse {
  ref: string;
  ownerTeacherId: string | null;
  owner: Person;
  draft: CourseContent;
  revision: number;
  editors: Person[];
  pending: { content: CourseContent; by: Person; days: number } | null;
  versions: { content: CourseContent; by: Person; approver: Person; days: number }[];
  reviews: [
    number,
    Person,
    "submitted" | "withdrawn" | "approved" | "returned",
    number | null,
    string | null,
  ][];
  updatedDays: number;
}

async function put(c: pg.Client, now: number, s: SeedCourse) {
  const at = (days: number) => new Date(now - days * DAY);
  await c.query(
    `insert into authored_course (org_id, ref, owner_teacher_id, owner_principal_id, owner_name, draft, revision,
       editors, pending_content, pending_by, pending_by_name, pending_at, updated_at)
     values (ogc_current_org(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      s.ref,
      s.ownerTeacherId,
      s.owner.id,
      s.owner.name,
      JSON.stringify(s.draft),
      s.revision,
      JSON.stringify(s.editors),
      s.pending ? JSON.stringify(s.pending.content) : null,
      s.pending?.by.id ?? null,
      s.pending?.by.name ?? null,
      s.pending ? at(s.pending.days) : null,
      at(s.updatedDays),
    ],
  );
  for (const [i, v] of s.versions.entries())
    await c.query(
      `insert into course_version (org_id, course_ref, version, content, submitted_by, approved_by, published_at, note)
       values (ogc_current_org(), $1, $2, $3, $4, $5, $6, null)`,
      [s.ref, i + 1, JSON.stringify(v.content), v.by.name, v.approver.name, at(v.days)],
    );
  for (const [i, [days, by, action, version, note]] of s.reviews.entries())
    await c.query(
      `insert into course_review (org_id, course_ref, seq, at, by_name, action, version, note)
       values (ogc_current_org(), $1, $2, $3, $4, $5, $6, $7)`,
      [s.ref, i + 1, at(days), by.name, action, version, note],
    );
}

/** Nova's sample courses; the caller has scoped the connection to Nova. */
export async function seedCourses(
  c: pg.Client,
  now: number,
  teachers: { tara: string; ben: string },
): Promise<void> {
  const P = COURSE_PEOPLE;
  await put(c, now, {
    ref: "CS-A2-EVERYDAY",
    ownerTeacherId: teachers.tara,
    owner: P.tara,
    draft: clone(A2_V2),
    revision: 6,
    editors: [],
    pending: null,
    versions: [
      { content: A2_V1, by: P.tara, approver: P.sam, days: 30 },
      { content: A2_V2, by: P.tara, approver: P.olivia, days: 10 },
    ],
    reviews: [
      [31, P.tara, "submitted", null, null],
      [30, P.sam, "approved", 1, null],
      [12, P.tara, "submitted", null, null],
      [11, P.olivia, "returned", null, "Add a quiz to “Making plans”."],
      [10.5, P.tara, "submitted", null, null],
      [10, P.olivia, "approved", 2, null],
    ],
    updatedDays: 10,
  });
  await put(c, now, {
    ref: "CS-B1-SPEAK",
    ownerTeacherId: teachers.tara,
    owner: P.tara,
    draft: clone(B1_DRAFT),
    revision: 4,
    editors: [P.tara],
    pending: null,
    versions: [{ content: B1_V1, by: P.tara, approver: P.sam, days: 9 }],
    reviews: [
      [10, P.tara, "submitted", null, null],
      [9, P.sam, "approved", 1, null],
    ],
    updatedDays: 3,
  });
  await put(c, now, {
    ref: "CS-IELTS-W1",
    ownerTeacherId: null,
    owner: P.sam,
    draft: clone(IELTS_V1),
    revision: 2,
    editors: [],
    pending: null,
    versions: [{ content: IELTS_V1, by: P.sam, approver: P.olivia, days: 12 }],
    reviews: [
      [13, P.sam, "submitted", null, null],
      [12, P.olivia, "approved", 1, null],
    ],
    updatedDays: 12,
  });
  await put(c, now, {
    ref: "CS-A2-PHONICS",
    ownerTeacherId: teachers.ben,
    owner: P.ben,
    draft: clone(PHONICS),
    revision: 3,
    editors: [P.ben],
    pending: { content: clone(PHONICS), by: P.ben, days: 1 },
    versions: [],
    reviews: [[1, P.ben, "submitted", null, null]],
    updatedDays: 1,
  });
}

/** The second tenant's course; the caller has scoped the connection to Lumen. */
export async function seedLumenCourse(c: pg.Client, now: number): Promise<void> {
  const P = COURSE_PEOPLE;
  await put(c, now, {
    ref: "CS-LUMEN-STARTER",
    ownerTeacherId: null,
    owner: P.lumen,
    draft: clone(LUMEN_STARTER),
    revision: 1,
    editors: [],
    pending: null,
    versions: [{ content: LUMEN_STARTER, by: P.lumen, approver: P.lumen, days: 5 }],
    reviews: [[5, P.lumen, "approved", 1, null]],
    updatedDays: 5,
  });
}
