// Course Studio (owner 22/11): OGC authors its own courses — lessons of typed blocks; draft →
// submit → a different person approves → immutable published version; teachers edit their own
// courses, staff every course of the org (courses:author); learners take the class course in My
// Learning, pinned to the version they started; quiz scores feed the skill profile. SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BLOCK_KINDS,
  BLOCK_REGISTRY,
  blockIssue,
  contentIssue,
  hideLessonAnswers,
  speakingScore,
  type BlockOf,
  type CourseContent,
} from "@ogc/contracts";
import { as } from "../../test/grants";
import { __resetCourseAuthoringForTests, mockCourseAuthoring as A } from "./mockCourseAuthoring";
import { __resetCourseProgressForTests, courseQuizEvidenceOf } from "./courseProgress";
import { __resetStudioLinksForTests, mockStudioLinks as L } from "./mockStudioLinks";
import { mockClassCoursePlayer as P } from "./mockClassCoursePlayer";
import { mockProfile } from "./mockProfile";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { classes } from "../../fixtures/teaching";
import { LEARNER_LINH } from "../../fixtures/personas";

const SAM = "demo-staff";
const OLIVIA = "demo-admin";
const TARA = "demo-teacher";
const BEN = "demo-teacher-2";
const LINH = "demo-learner";
const SAM_P = "iios-principal-staff-1";

beforeEach(() => {
  __resetCourseAuthoringForTests();
  __resetCourseProgressForTests();
  __resetStudioLinksForTests();
});
afterEach(() => __attachForTests(SAM_P, null));

const get = async (who: string, ref: string) => (await A.get(as(who), ref))!;
const edit = async (who: string, ref: string, f: (c: CourseContent) => CourseContent) => {
  const c = await get(who, ref);
  return A.saveDraft(as(who), ref, f(structuredClone(c.draft)), c.draftRevision);
};

describe("course studio — blocks are validated fail-closed", () => {
  it("every registry block is valid as a draft; unknown kinds and fields are refused", () => {
    for (const k of BLOCK_KINDS)
      expect(blockIssue(BLOCK_REGISTRY[k].make("x"), "draft")).toBeNull();
    expect(blockIssue({ id: "x", kind: "html", html: "<b>" }, "draft")).toMatch(/unknown block/);
    expect(blockIssue({ id: "x", kind: "text", text: "a", html: "<b>" }, "draft")).toMatch(
      /unknown field/,
    );
    expect(blockIssue({ id: "x", kind: "callout", tone: "red", text: "a" }, "draft")).toMatch(
      /tone/,
    );
  });

  it("links: https only; video only YouTube / Vimeo; no javascript:", () => {
    const vocab = (imageUrl: string) => {
      const b = BLOCK_REGISTRY.vocab.make("v");
      return { ...b, cards: [{ ...b.cards[0]!, imageUrl }] };
    };
    expect(blockIssue(vocab("https://img.example.org/a.png"), "draft")).toBeNull();
    expect(blockIssue(vocab("http://img.example.org/a.png"), "draft")).toMatch(/https/);
    expect(blockIssue(vocab("javascript:alert(1)"), "draft")).toMatch(/https/);
    const video = (url: string) => ({ id: "v", kind: "video", url, caption: "" });
    expect(blockIssue(video("https://youtu.be/abc"), "submit")).toBeNull();
    expect(blockIssue(video("https://evil.example/watch"), "submit")).toMatch(/only youtube/);
    expect(blockIssue(video("https://user:pw@youtu.be/abc"), "submit")).toMatch(/password/);
  });

  it("quiz: 2–6 options, a correct one in range; before review no empty or repeated options", () => {
    const q = (options: string[], correct: number) => ({
      id: "q",
      kind: "quiz",
      question: "Q?",
      options,
      correct,
    });
    expect(blockIssue(q(["a"], 0), "draft")).toMatch(/2–6/);
    expect(blockIssue(q(["a", "b"], 2), "draft")).toMatch(/correct/);
    expect(blockIssue(q(["a", ""], 0), "draft")).toBeNull();
    expect(blockIssue(q(["a", ""], 0), "submit")).toMatch(/empty/);
    expect(blockIssue(q(["a", "A "], 0), "submit")).toMatch(/same/);
  });

  it("speaking: 1–8 turns of 2–4 distinct replies, a natural one in range; before review a coach and model line", () => {
    const turn = (o: Partial<BlockOf<"speaking">["turns"][number]> = {}) => ({
      coach: "Hi! How was your weekend?",
      options: ["It was great.", "Weekend is Sunday."],
      natural: 0,
      model: "It was great, thanks.",
      tip: "",
      ...o,
    });
    const sp = (turns: unknown[], extra: object = {}) => ({
      id: "s",
      kind: "speaking",
      scenario: "Weekend",
      turns,
      ...extra,
    });
    expect(blockIssue(sp([turn()]), "submit")).toBeNull();
    expect(blockIssue(sp([]), "draft")).toMatch(/1–8 turns/);
    expect(blockIssue(sp(Array(9).fill(turn())), "draft")).toMatch(/1–8 turns/);
    expect(blockIssue(sp([turn({ options: ["a"] })]), "draft")).toMatch(/2–4 replies/);
    expect(blockIssue(sp([turn({ options: ["a", "b", "c", "d", "e"] })]), "draft")).toMatch(
      /2–4 replies/,
    );
    expect(blockIssue(sp([turn({ natural: 2 })]), "draft")).toMatch(/natural/);
    expect(blockIssue(sp([turn({ coach: "" })]), "draft")).toBeNull();
    expect(blockIssue(sp([turn({ coach: "" })]), "submit")).not.toBeNull();
    expect(blockIssue(sp([turn({ model: "" })]), "submit")).not.toBeNull();
    expect(blockIssue(sp([turn({ options: ["a", "A "] })]), "submit")).not.toBeNull();
    expect(blockIssue(sp([{ ...turn(), audio: "x" }]), "draft")).not.toBeNull();
    expect(blockIssue(sp([turn()], { html: "<b>" }), "draft")).toMatch(/unknown field/);
  });

  it("speaking: % natural replies; answers and coaching are hidden until the lesson is done", () => {
    const b = {
      id: "s",
      kind: "speaking",
      scenario: "Weekend",
      turns: [0, 1, 2, 0].map((natural) => ({
        coach: "c",
        options: ["a", "b", "c"],
        natural,
        model: "m",
        tip: "t",
      })),
    } as BlockOf<"speaking">;
    expect(speakingScore(b, [0, 1, 0, 0])).toBe(75);
    expect(speakingScore(b, [1, 0, 0, 1])).toBe(0);
    const hidden = hideLessonAnswers({ id: "l", title: "L", blocks: [b] }).blocks[0] as typeof b;
    expect(hidden.turns.map((t) => [t.natural, t.model, t.tip])).toEqual(
      Array(4).fill([-1, "", ""]),
    );
    expect(b.turns[0].natural).toBe(0); // the original is untouched
  });

  it("a course needs a lesson with a block before review", () => {
    const c: CourseContent = { title: "New", level: "A1", summary: "", lessons: [] };
    expect(contentIssue(c, "draft")).toBeNull();
    expect(contentIssue(c, "submit")).toMatch(/at least one lesson/);
  });
});

describe("course studio — who sees and edits what", () => {
  it("staff see every course of their org; a teacher their own plus published ones; learners nothing", async () => {
    const staff = (await A.list(as(SAM)))!.courses.map((c) => c.ref).sort();
    expect(staff).toEqual(["CS-A2-EVERYDAY", "CS-A2-PHONICS", "CS-B1-SPEAK", "CS-IELTS-W1"]);
    const tara = (await A.list(as(TARA)))!.courses;
    expect(tara.map((c) => c.ref).sort()).toEqual(["CS-A2-EVERYDAY", "CS-B1-SPEAK", "CS-IELTS-W1"]);
    expect(tara.find((c) => c.ref === "CS-IELTS-W1")!.canEdit).toBe(false);
    expect(await A.get(as(TARA), "CS-A2-PHONICS")).toBeNull(); // Ben's, never published
    for (const p of [LINH, "demo-guardian"]) expect(await A.list(as(p))).toBeNull();
    expect(await A.get(as(SAM), "CS-LUMEN-STARTER")).toBeNull(); // another org
    expect(await A.get(as("demo-staff-org2"), "CS-A2-EVERYDAY")).toBeNull();
  });

  it("a teacher edits only their own courses; staff edit any course of the org", async () => {
    expect(await edit(TARA, "CS-B1-SPEAK", (c) => ({ ...c, summary: "Tara" }))).toMatchObject({
      ok: true,
    });
    expect(await edit(TARA, "CS-IELTS-W1", (c) => ({ ...c, summary: "x" }))).toMatchObject({
      reason: "not_allowed",
    });
    expect(await edit(SAM, "CS-B1-SPEAK", (c) => ({ ...c, summary: "Sam" }))).toMatchObject({
      ok: true,
    });
    const c = await get(TARA, "CS-B1-SPEAK");
    expect(c.draft.summary).toBe("Sam");
    expect(c.editorsSinceLastPublication).toEqual(["Tara (Teacher)", "Sam (Org Staff)"]);
  });

  it("a stale save is refused (someone saved in between)", async () => {
    const c = await get(TARA, "CS-B1-SPEAK");
    expect(await edit(SAM, "CS-B1-SPEAK", (x) => ({ ...x, summary: "first" }))).toMatchObject({
      ok: true,
    });
    expect(
      await A.saveDraft(
        as(TARA),
        "CS-B1-SPEAK",
        { ...c.draft, summary: "second" },
        c.draftRevision,
      ),
    ).toMatchObject({ reason: "conflict" });
  });

  it("an access policy without courses:author cannot write (D1 front desk)", async () => {
    __attachForTests(SAM_P, "policy-front-desk-d1");
    expect(await edit(SAM, "CS-B1-SPEAK", (c) => ({ ...c, summary: "x" }))).toMatchObject({
      reason: "access_policy",
    });
    expect(await A.create(as(SAM), "Blocked course", "A1")).toMatchObject({
      reason: "access_policy",
    });
  });

  it("a teacher creates a course; it starts as a draft only they and staff see", async () => {
    const r = await A.create(as(BEN), "Ben's Listening", "A2");
    expect(r).toMatchObject({ ok: true });
    const ref = (r as { ref: string }).ref;
    expect((await get(BEN, ref)).status).toBe("draft");
    expect(await A.get(as(TARA), ref)).toBeNull();
    expect((await get(SAM, ref)).canEdit).toBe(true);
    expect(await A.create(as(BEN), "x", "A2")).toMatchObject({ reason: "invalid" }); // title 3+
  });
});

describe("course studio — review and immutable publication", () => {
  it("submit needs a complete draft and a change since the last publication", async () => {
    expect(await A.submit(as(TARA), "CS-A2-EVERYDAY")).toMatchObject({
      reason: "invalid_step",
      detail: expect.stringMatching(/nothing changed/),
    });
    await edit(TARA, "CS-B1-SPEAK", (c) => {
      c.lessons[2].blocks.push({
        id: "q-new",
        kind: "quiz",
        question: "",
        options: ["", ""],
        correct: 0,
      });
      return c;
    });
    expect(await A.submit(as(TARA), "CS-B1-SPEAK")).toMatchObject({ reason: "invalid" });
  });

  it("the submitter, an editor, or a teacher cannot approve; another staff member can", async () => {
    // Ben submitted Phonics: Ben (teacher) cannot approve; Sam and Olivia may.
    expect(await A.approve(as(BEN), "CS-A2-PHONICS", "")).toMatchObject({ reason: "not_allowed" });
    expect((await get(SAM, "CS-A2-PHONICS")).canReview).toBe(true);
    // Sam edits Tara's B1 draft, Tara submits: Sam may not approve, Olivia may.
    await edit(SAM, "CS-B1-SPEAK", (c) => ({ ...c, summary: "tightened" }));
    expect(await A.submit(as(TARA), "CS-B1-SPEAK")).toEqual({ ok: true });
    expect(await A.approve(as(SAM), "CS-B1-SPEAK", "")).toMatchObject({
      reason: "own_step",
      detail: expect.stringMatching(/edited/),
    });
    expect(await A.approve(as(TARA), "CS-B1-SPEAK", "")).toMatchObject({ reason: "not_allowed" });
    expect(await A.approve(as(OLIVIA), "CS-B1-SPEAK", "Looks good")).toEqual({ ok: true });
    const c = await get(SAM, "CS-B1-SPEAK");
    expect(c).toMatchObject({ status: "published", publishedVersion: 2, pending: null });
    expect(c.versions[0]).toMatchObject({
      version: 2,
      approvedBy: "Olivia (Org Admin)",
      note: "Looks good",
    });
    expect(c.reviews.slice(0, 2).map((r) => r.action)).toEqual(["approved", "submitted"]);
    expect(c.editorsSinceLastPublication).toEqual([]);
  });

  it("whoever submits cannot approve, even without editing (Sam submits Tara's edits)", async () => {
    await edit(TARA, "CS-B1-SPEAK", (c) => ({ ...c, summary: "Tara's change" }));
    expect(await A.submit(as(SAM), "CS-B1-SPEAK")).toEqual({ ok: true });
    expect(await A.approve(as(SAM), "CS-B1-SPEAK", "")).toMatchObject({
      reason: "own_step",
      detail: expect.stringMatching(/submitted/),
    });
    expect(await A.approve(as(OLIVIA), "CS-B1-SPEAK", "")).toEqual({ ok: true });
  });

  it("staff who submit their own course need someone else (Olivia approves Sam's)", async () => {
    await edit(SAM, "CS-IELTS-W1", (c) => ({ ...c, summary: "v2" }));
    await A.submit(as(SAM), "CS-IELTS-W1");
    expect(await A.approve(as(SAM), "CS-IELTS-W1", "")).toMatchObject({ reason: "own_step" });
    expect(await A.approve(as(OLIVIA), "CS-IELTS-W1", "")).toEqual({ ok: true });
  });

  it("while in review the draft is locked; the author may withdraw; a return needs a note", async () => {
    expect(await edit(BEN, "CS-A2-PHONICS", (c) => ({ ...c, summary: "x" }))).toMatchObject({
      reason: "invalid_step",
    });
    expect(await A.returnForChanges(as(SAM), "CS-A2-PHONICS", " ")).toMatchObject({
      reason: "invalid",
    });
    expect(await A.returnForChanges(as(SAM), "CS-A2-PHONICS", "Add word stress")).toEqual({
      ok: true,
    });
    const c = await get(BEN, "CS-A2-PHONICS");
    expect(c).toMatchObject({ status: "draft", publishedVersion: null });
    expect(c.reviews[0]).toMatchObject({
      action: "returned",
      note: "Add word stress",
      by: "Sam (Org Staff)",
    });
    await A.submit(as(BEN), "CS-A2-PHONICS");
    expect(await A.withdraw(as(BEN), "CS-A2-PHONICS")).toEqual({ ok: true });
    expect((await get(BEN, "CS-A2-PHONICS")).reviews[0].action).toBe("withdrawn");
  });

  it("a published version never changes; later edits are 'unpublished changes'", async () => {
    const before = (await get(SAM, "CS-A2-EVERYDAY")).versions[0];
    expect(Object.isFrozen(before.content.lessons[0].blocks[0])).toBe(true);
    const snapshot = JSON.stringify(before.content);
    await edit(TARA, "CS-A2-EVERYDAY", (c) => {
      c.lessons[0].title = "At the supermarket";
      return c;
    });
    const after = await get(SAM, "CS-A2-EVERYDAY");
    expect(after.status).toBe("unpublished_changes");
    expect(JSON.stringify(after.versions[0].content)).toBe(snapshot);
    expect(after.versions[0].content.lessons[0].title).toBe("At the market");
    // A teacher who only reads another's course sees the published version, not the draft.
    expect((await get(BEN, "CS-A2-EVERYDAY")).draft.lessons[0].title).toBe("At the market");
  });
});

describe("course studio — learners take the class course in My Learning", () => {
  const A2M = classes[0].id;

  it("Linh (A2 Morning) gets the linked course at the latest version; answers hidden until done", async () => {
    const mine = (await P.mine(as(LINH)))!;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ ref: "CS-A2-EVERYDAY", version: 2, completedLessons: 0 });
    const l = (await P.lesson(as(LINH), "CS-A2-EVERYDAY", "a2-l1"))!;
    const quiz = l.lesson.blocks.find((b) => b.kind === "quiz")!;
    expect(quiz).toMatchObject({ correct: -1 });
    expect(await P.lesson(as(LINH), "CS-B1-SPEAK", "b1-l1")).toBeNull(); // not her class's
    for (const p of [TARA, SAM, "demo-guardian"]) expect(await P.mine(as(p))).toBeNull();
  });

  it("completing needs every answer; the quiz score is skill evidence (use of English)", async () => {
    const before = (await mockProfile.getProfile(as(LINH)))!.skills.use_of_english.evidenceCount;
    expect(await P.complete(as(LINH), "CS-A2-EVERYDAY", "a2-l2", {}, {})).toMatchObject({
      reason: "invalid",
    });
    expect(
      await P.complete(
        as(LINH),
        "CS-A2-EVERYDAY",
        "a2-l2",
        { "a2-l2-b3": 0 },
        { "a2-l2-b4": "  " },
      ),
    ).toMatchObject({ reason: "invalid", detail: expect.stringMatching(/reflection/) });
    expect(
      await P.complete(
        as(LINH),
        "CS-A2-EVERYDAY",
        "a2-l2",
        { "a2-l2-b3": 0, bogus: 1 },
        { "a2-l2-b4": "By bus" },
      ),
    ).toMatchObject({ reason: "invalid" });
    expect(
      await P.complete(
        as(LINH),
        "CS-A2-EVERYDAY",
        "a2-l2",
        { "a2-l2-b3": 0 },
        { "a2-l2-b4": "By bus" },
      ),
    ).toEqual({ ok: true, score: 100, practiceScore: null });
    expect(
      await P.complete(as(LINH), "CS-A2-EVERYDAY", "a2-l2", { "a2-l2-b3": 0 }, { "a2-l2-b4": "x" }),
    ).toMatchObject({ reason: "invalid_step" });
    const after = (await mockProfile.getProfile(as(LINH)))!.skills.use_of_english.evidenceCount;
    expect(after).toBe(before + 1);
    expect(courseQuizEvidenceOf(LEARNER_LINH, classes[0].orgId)).toEqual([
      expect.objectContaining({
        skill: "use_of_english",
        score: 100,
        attemptId: "CS:CS-A2-EVERYDAY:v2:a2-l2",
      }),
    ]);
    const shown = (await P.lesson(as(LINH), "CS-A2-EVERYDAY", "a2-l2"))!;
    expect(shown.completed).toMatchObject({ score: 100, reflections: { "a2-l2-b4": "By bus" } });
    expect(shown.lesson.blocks.find((b) => b.kind === "quiz")).toMatchObject({ correct: 0 });
  });

  it("a learner stays on the version they started when a new one is published", async () => {
    await P.complete(as(LINH), "CS-A2-EVERYDAY", "a2-l1", { "a2-l1-b4": 0 }, {}); // wrong → 0%
    await edit(TARA, "CS-A2-EVERYDAY", (c) => {
      c.lessons.push({
        id: "a2-l4",
        title: "Review",
        blocks: [{ id: "a2-l4-b1", kind: "text", text: "Review" }],
      });
      return c;
    });
    await A.submit(as(TARA), "CS-A2-EVERYDAY");
    await A.approve(as(SAM), "CS-A2-EVERYDAY", "");
    const mine = (await P.mine(as(LINH)))!;
    expect(mine[0]).toMatchObject({ version: 2, latestVersion: 3, completedLessons: 1 });
    expect(mine[0].lessons).toHaveLength(3);
    expect(mine[0].lessons[0]).toMatchObject({ score: 0 });
    expect(await P.lesson(as(LINH), "CS-A2-EVERYDAY", "a2-l4")).toBeNull(); // not in her v2
    // The class view shows each learner's own version.
    const id = (await L.getOverview(as(SAM)))!.links.find((x) => x.classId === A2M)!.id;
    const rows = (await L.progress(as(SAM), id))!;
    expect(rows.find((r) => r.name === "Linh N.")).toMatchObject({ version: 2, totalLessons: 3 });
    expect(rows.find((r) => r.name === "Minh T.")).toMatchObject({ version: 3, totalLessons: 4 });
  });
});
