// Course Studio blocks, part A (owner 24/11): image, book pages, vocabulary decks (older single
// cards read as a deck of one), practice, Eagle Flight Match, Time Detective. Practice and the
// mini-games are scored for XP only — never skill evidence; their answers stay hidden (and the
// order of what is shown gives nothing away) until the lesson is completed.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  blockIssue,
  BLOCK_KINDS,
  BLOCK_REGISTRY,
  detectiveCards,
  hideLessonAnswers,
  lessonPracticeScore,
  matchChoices,
  normalizeBlock,
  practiceChoices,
  type AuthoredCourseDetail,
  type BlockOf,
  type CourseBlock,
  type CourseContent,
  type CourseLesson,
  type LearnerGamification,
  type MyLessonView,
  type LearnerProfile,
} from "@ogc/contracts";
import { buildIiosMock } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "blocks-test-secret-0123456789abcde";
const NOW = Date.parse("2026-11-24T05:00:00Z");
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const MINH = "iios-principal-learner-2";
let seq = 0;
const key = () => `blk-${Date.now()}-${++seq}-abc`;

const MATCH: BlockOf<"eagle_match"> = {
  id: "m",
  kind: "eagle_match",
  prompt: "Match the plant part to its job",
  pairs: [
    { left: "root", right: "drinks water" },
    { left: "leaf", right: "catches sunlight" },
    { left: "stem", right: "carries water up" },
  ],
};
const DETECTIVE: BlockOf<"time_detective"> = {
  id: "t",
  kind: "time_detective",
  prompt: "From seed to plant",
  events: ["A seed is planted", "Roots grow", "A shoot appears", "Leaves open"],
};
const PRACTICE: BlockOf<"practice"> = {
  id: "p",
  kind: "practice",
  title: "Plant parts",
  questions: [
    { question: "Which part grows under the ground?", options: ["Root", "Leaf"], correct: 0 },
    { question: "What do leaves catch?", options: ["Rocks", "Sunlight", "Rain"], correct: 1 },
  ],
};

describe("new blocks: validation, hiding, scoring (no database)", () => {
  it("every registry block is a valid draft; 14 kinds; unknown fields refused at every level", () => {
    expect(BLOCK_KINDS).toHaveLength(14);
    for (const k of BLOCK_KINDS)
      expect(blockIssue(BLOCK_REGISTRY[k].make("x"), "draft")).toBeNull();
    for (const [b, re] of [
      [
        { id: "x", kind: "image", url: "https://a.test/p.png", caption: "", credit: "", alt: "" },
        /unknown field/,
      ],
      [{ id: "x", kind: "image", url: "http://a.test/p.png", caption: "", credit: "" }, /https/],
      [{ id: "x", kind: "image", url: "javascript:alert(1)", caption: "", credit: "" }, /https/],
      [
        { ...PRACTICE, questions: [{ ...PRACTICE.questions[0]!, hint: "x" }] },
        /question 1: unknown field/,
      ],
      [
        { ...MATCH, pairs: [{ left: "a", right: "b", x: 1 }, MATCH.pairs[1]] },
        /pair 1: unknown field/,
      ],
      [{ ...MATCH, choices: ["a"] }, /unknown field/], // the learner's `choices` is never authored
      [
        {
          id: "x",
          kind: "vocab",
          title: "",
          cards: [
            { word: "a", meaning: "b", example: "", translation: "", imageUrl: "", audio: "" },
          ],
        },
        /card 1: unknown field/,
      ],
      [{ id: "x", kind: "book_page", title: "", pages: [] }, /1–12 pages/],
      [{ ...DETECTIVE, events: ["a", "b"] }, /3–8 events/],
      [{ ...MATCH, pairs: [MATCH.pairs[0]] }, /2–8 pairs/],
      [
        {
          id: "x",
          kind: "vocab",
          title: "",
          cards: Array(13).fill({
            word: "",
            meaning: "",
            example: "",
            translation: "",
            imageUrl: "",
          }),
        },
        /1–12 cards/,
      ],
    ] as [unknown, RegExp][])
      expect(blockIssue(b, "draft")).toMatch(re);
    // submit: required text, no repeats
    expect(
      blockIssue({ ...MATCH, pairs: [MATCH.pairs[0], { left: "Root", right: "x" }] }, "submit"),
    ).toMatch(/two left items are the same/);
    expect(blockIssue({ ...DETECTIVE, events: ["a", "b", "A"] }, "submit")).toMatch(/two events/);
    expect(
      blockIssue(
        { id: "x", kind: "book_page", title: "", pages: [{ heading: "", body: "" }] },
        "submit",
      ),
    ).toMatch(/body is empty/);
    expect(
      blockIssue(
        { id: "x", kind: "book_page", title: "", pages: [{ heading: "", body: "" }] },
        "draft",
      ),
    ).toBeNull();
    for (const b of [MATCH, DETECTIVE, PRACTICE]) expect(blockIssue(b, "submit")).toBeNull();
  });

  it("an older single vocabulary card is still valid and reads as a deck of one", () => {
    const old = {
      id: "v",
      kind: "vocab",
      word: "a kilo of",
      meaning: "one kilogram",
      example: "",
      translation: "một ký",
      imageUrl: "",
    };
    expect(blockIssue(old, "submit")).toBeNull();
    expect(blockIssue({ ...old, imageUrl: "http://x.test/a.png" }, "draft")).toMatch(/https/);
    expect(normalizeBlock(old as unknown as CourseBlock)).toEqual({
      id: "v",
      kind: "vocab",
      title: "",
      cards: [
        {
          word: "a kilo of",
          meaning: "one kilogram",
          example: "",
          translation: "một ký",
          imageUrl: "",
        },
      ],
    });
  });

  it("before completion nothing gives the answer away; the shown order is never the answer", () => {
    const lesson: CourseLesson = { id: "l", title: "Plants", blocks: [PRACTICE, MATCH, DETECTIVE] };
    const hidden = hideLessonAnswers(lesson).blocks;
    expect((hidden[0] as BlockOf<"practice">).questions.map((q) => q.correct)).toEqual([-1, -1]);
    const m = hidden[1] as BlockOf<"eagle_match">;
    expect(m.pairs.map((p) => p.right)).toEqual(["", "", ""]);
    expect([...m.choices!].sort()).toEqual(MATCH.pairs.map((p) => p.right).sort());
    expect(m.choices!.some((c, i) => c !== MATCH.pairs[i]!.right)).toBe(true);
    const d = hidden[2] as BlockOf<"time_detective">;
    expect([...d.events].sort()).toEqual([...DETECTIVE.events].sort());
    expect(d.events).not.toEqual(DETECTIVE.events);
    // already in alphabetical order: the shown order is reversed, never the answer itself
    const abc: BlockOf<"time_detective"> = { ...DETECTIVE, events: ["Apple", "Banana", "Cherry"] };
    expect(detectiveCards(abc)).toEqual(["Cherry", "Banana", "Apple"]);
    expect(
      matchChoices({
        ...MATCH,
        pairs: [
          { left: "1", right: "a" },
          { left: "2", right: "b" },
        ],
      }),
    ).toEqual(["b", "a"]);
  });

  it("answers are checked and scored: practice per question, match per pair, detective per position", () => {
    expect(practiceChoices(PRACTICE, [0])).toBeNull(); // every question
    expect(practiceChoices(PRACTICE, [0, 3])).toBeNull(); // option out of range
    expect(practiceChoices(MATCH, [0, 0, 1])).toBeNull(); // each right item once
    expect(practiceChoices(DETECTIVE, [0, 1, 2])).toBeNull(); // every event
    expect(practiceChoices(DETECTIVE, [0, 1, 2, 2.5])).toBeNull();
    const shownM = matchChoices(MATCH);
    const rightM = MATCH.pairs.map((p) => shownM.indexOf(p.right));
    const shownD = detectiveCards(DETECTIVE);
    const rightD = DETECTIVE.events.map((e) => shownD.indexOf(e));
    const lesson: CourseLesson = { id: "l", title: "Plants", blocks: [PRACTICE, MATCH, DETECTIVE] };
    expect(lessonPracticeScore(lesson, { p: [0, 1], m: rightM, t: rightD })).toBe(100);
    // 1 of 2 + 1 of 3 (two swapped) + 2 of 4 (two swapped) = 4 of 9
    const swap = (xs: number[], i: number, j: number) => {
      const y = [...xs];
      [y[i], y[j]] = [y[j]!, y[i]!];
      return y;
    };
    expect(
      lessonPracticeScore(lesson, { p: [0, 0], m: swap(rightM, 0, 1), t: swap(rightD, 2, 3) }),
    ).toBe(44);
    expect(lessonPracticeScore({ ...lesson, blocks: [] }, {})).toBeNull();
  });
});

describe.skipIf(!hasPg)("new blocks — API: authored, published, learned", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;

  beforeAll(async () => {
    ({ app: iios } = buildIiosMock({
      key: randomBytes(32),
      clientId: "ogc",
      clientSecret: SECRET,
    }));
    await iios.listen({ host: "127.0.0.1", port: 0 });
    iiosUrl = `http://127.0.0.1:${(iios.server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    await api?.close();
    await t?.drop();
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
    api = buildApi({
      db: t.app,
      iios: httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
      now: () => NOW,
    });
    await api.ready();
  });
  afterAll(async () => {
    await api?.close();
    await iios?.close();
    await t?.drop();
  });

  const as = async (principalId: string) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId: NOVA }),
    });
    const g = ((await r.json()) as { grant: string }).grant;
    return (method: "GET" | "POST", url: string, body?: unknown) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": NOVA,
          ...(method !== "GET" ? { "idempotency-key": key() } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
  };
  const REF = "CS-A2-EVERYDAY";
  const LESSON: CourseLesson = {
    id: "a2-l4",
    title: "Plants around us",
    blocks: [
      {
        id: "a2-l4-b1",
        kind: "image",
        url: "https://images.example.org/plants.jpg",
        caption: "Plants by a window",
        credit: "Synthetic photo",
      },
      {
        id: "a2-l4-b2",
        kind: "book_page",
        title: "A tiny seed",
        pages: [
          { heading: "Page 1", body: "A seed is small." },
          { heading: "Page 2", body: "It grows." },
        ],
      },
      {
        id: "a2-l4-b3",
        kind: "vocab",
        title: "Plant parts words",
        cards: [
          {
            word: "root",
            meaning: "under the ground",
            example: "",
            translation: "rễ",
            imageUrl: "",
          },
          {
            word: "leaf",
            meaning: "catches sunlight",
            example: "",
            translation: "lá",
            imageUrl: "",
          },
        ],
      },
      { ...PRACTICE, id: "a2-l4-b4" },
      { ...MATCH, id: "a2-l4-b5" },
      { ...DETECTIVE, id: "a2-l4-b6" },
      {
        id: "a2-l4-b7",
        kind: "quiz",
        question: "Plants need…",
        options: ["sunlight", "plastic"],
        correct: 0,
      },
    ],
  };

  async function publish() {
    const tara = await as(TARA);
    const d = (await tara("GET", `/v1/courses/${REF}`)).json() as AuthoredCourseDetail;
    const content: CourseContent = { ...d.draft, lessons: [...d.draft.lessons, LESSON] };
    const s = await tara("POST", `/v1/courses/${REF}/draft`, {
      content,
      baseRevision: d.draftRevision,
    });
    expect(s.json()).toMatchObject({ ok: true });
    expect((await tara("POST", `/v1/courses/${REF}/submit`, {})).json()).toMatchObject({
      ok: true,
    });
    expect((await (await as(SAM))("POST", `/v1/courses/${REF}/approve`, {})).json()).toMatchObject({
      ok: true,
    });
  }

  it("the learner's view hides answers; completing needs every practice answer; practice is XP only", async () => {
    await publish();
    const minh = await as(MINH);
    const view = (await minh("GET", `/v1/me/class-courses/${REF}/a2-l4`)).json() as MyLessonView;
    expect(view.version).toBe(3);
    const b = view.lesson.blocks;
    expect((b[3] as BlockOf<"practice">).questions.map((q) => q.correct)).toEqual([-1, -1]);
    expect((b[4] as BlockOf<"eagle_match">).pairs.every((p) => p.right === "")).toBe(true);
    const choices = (b[4] as BlockOf<"eagle_match">).choices!;
    const shown = (b[5] as BlockOf<"time_detective">).events;
    expect(shown).not.toEqual(DETECTIVE.events);
    expect((b[6] as BlockOf<"quiz">).correct).toBe(-1);
    expect(JSON.stringify(view)).not.toContain('"correct":0');

    const done = (practice: Record<string, unknown>) =>
      minh("POST", `/v1/me/class-courses/${REF}/a2-l4/complete`, {
        answers: { "a2-l4-b7": 0 },
        reflections: {},
        practice,
      });
    const rightM = MATCH.pairs.map((p) => choices.indexOf(p.right));
    const rightD = DETECTIVE.events.map((e) => shown.indexOf(e));
    for (const [p, detail] of [
      [{ "a2-l4-b4": [0, 1], "a2-l4-b5": rightM }, /put every event in order/],
      [
        { "a2-l4-b4": [0], "a2-l4-b5": rightM, "a2-l4-b6": rightD },
        /answer every practice question/,
      ],
      [
        { "a2-l4-b4": [0, 1], "a2-l4-b5": [0, 0, 0], "a2-l4-b6": rightD },
        /match every item, each once/,
      ],
      [
        { "a2-l4-b4": [0, 1], "a2-l4-b5": rightM, "a2-l4-b6": rightD, "a2-l4-b9": [0] },
        /not in this lesson/,
      ],
    ] as const) {
      const r = await done(p);
      expect(r.statusCode, JSON.stringify(p)).toBe(422);
      expect((r.json() as { detail: string }).detail).toMatch(detail);
    }
    // practice: 1 of 2; match: all 3; detective: 2 of 4 → 6 of 9 = 67%
    const swapped = [...rightD];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    const ok = await done({ "a2-l4-b4": [1, 1], "a2-l4-b5": rightM, "a2-l4-b6": swapped });
    expect(ok.json()).toEqual({ ok: true, score: 100, practiceScore: 67 });

    const after = (await minh("GET", `/v1/me/class-courses/${REF}/a2-l4`)).json() as MyLessonView;
    expect(after.completed).toMatchObject({
      score: 100,
      practiceScore: 67,
      answers: { "a2-l4-b7": 0 },
      practice: { "a2-l4-b4": [1, 1], "a2-l4-b5": rightM, "a2-l4-b6": swapped },
    });
    expect((after.lesson.blocks[4] as BlockOf<"eagle_match">).pairs[0]!.right).toBe("drinks water");
    expect((after.lesson.blocks[5] as BlockOf<"time_detective">).events).toEqual(DETECTIVE.events);

    // skill profile: only the quiz is Use of English evidence — the practice score is not
    const skills = (await minh("GET", "/v1/me/skills")).json() as LearnerProfile;
    // Minh's placement Use of English 52; one quiz at 100% → 0.4 × 100 + 0.6 × 52 = 71
    expect(skills.skills.use_of_english).toMatchObject({ level: 71, evidenceCount: 1 });
    // rewards: +10 completed, +20 quiz 100%, +13 practice 67%
    const [g] = (await minh("GET", "/v1/me/rewards")).json() as LearnerGamification[];
    expect(g!.recent.map((e) => [e.xp, e.evidence])).toEqual(
      expect.arrayContaining([
        [10, "Plants around us · completed"],
        [20, "Plants around us · scored 100%"],
        [13, "Plants around us · practice 67%"],
      ]),
    );
  });

  it("an older single card in a published version reads as a deck; the draft saves it in the new form", async () => {
    const minh = await as(MINH);
    const v = (await minh("GET", `/v1/me/class-courses/${REF}/a2-l1`)).json() as MyLessonView;
    expect(v.lesson.blocks.find((x) => x.id === "a2-l1-b3")).toEqual({
      id: "a2-l1-b3",
      kind: "vocab",
      title: "",
      cards: [
        {
          word: "a kilo of",
          meaning: "one kilogram of something",
          example: "Can I have a kilo of mangoes, please?",
          translation: "một ký",
          imageUrl: "",
        },
      ],
    });
    // after completing it, the full lesson (answers shown) still reads the card as a deck
    await minh("POST", `/v1/me/class-courses/${REF}/a2-l1/complete`, {
      answers: { "a2-l1-b4": 1 },
      reflections: {},
    });
    const done = (await minh("GET", `/v1/me/class-courses/${REF}/a2-l1`)).json() as MyLessonView;
    expect(done.completed).not.toBeNull();
    expect(done.lesson.blocks.find((x) => x.id === "a2-l1-b3")).toMatchObject({
      title: "",
      cards: [{ word: "a kilo of" }],
    });
    await publish(); // Tara re-saves the whole draft
    const d = (await (await as(TARA))("GET", `/v1/courses/${REF}`)).json() as AuthoredCourseDetail;
    expect(d.draft.lessons[0]!.blocks.find((x) => x.id === "a2-l1-b3")).toMatchObject({
      kind: "vocab",
      title: "",
      cards: [{ word: "a kilo of" }],
    });
    // the earlier published versions keep their stored form (immutable)
    const v1 = JSON.stringify(d.versions.find((x) => x.version === 1)!.content);
    expect(v1).toContain('"word":"a kilo of"');
    expect(v1).not.toContain('"cards"');
  });
});
