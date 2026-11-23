import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  AuthoredCourseDetail,
  LearnerStudioProgress,
  MyClassCourse,
  MyLessonView,
  StudioCourse,
  StudioOverview,
  WorkforceOverview,
} from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { A2E, A2M, B1E, L, LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "classc-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-23T05:00:00Z");
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const TARA = "iios-principal-teacher-1";
const BEN = "iios-principal-teacher-2";
const LINH = "iios-principal-learner-1";
const MINH = "iios-principal-learner-2";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `ccl-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("class courses + My Learning — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;
  let now = NOW;

  beforeAll(async () => {
    ({ app: iios, state } = buildIiosMock({
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
    state.attachments.clear();
    now = NOW;
    api = buildApi({
      db: t.app,
      iios: httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
      now: () => now,
    });
    await api.ready();
  });
  afterAll(async () => {
    await api?.close();
    await iios?.close();
    await t?.drop();
  });

  const as = async (principalId: string, orgId = NOVA) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId }),
    });
    const g = ((await r.json()) as { grant: string }).grant;
    return (method: "GET" | "POST", url: string, body?: unknown, idem = key()) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": orgId,
          ...(method !== "GET" ? { "idempotency-key": idem } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
  };
  type Call = Awaited<ReturnType<typeof as>>;
  const ownerQuery = async (q: string) => {
    const c = new pg.Client({ connectionString: t.ownerUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.org_id', $1, true)", [NOVA]);
      const r = await c.query(q);
      await c.query("commit");
      return r;
    } finally {
      await c.end();
    }
  };
  const overview = async (c: Call) =>
    (await c("GET", "/v1/class-courses")).json() as StudioOverview;
  const mine = async (c: Call) =>
    (await c("GET", "/v1/me/class-courses")).json() as MyClassCourse[];
  const lesson = async (c: Call, ref: string, id: string) =>
    (await c("GET", `/v1/me/class-courses/${ref}/${id}`)).json() as MyLessonView;
  const complete = (c: Call, ref: string, id: string, answers: object, reflections: object = {}) =>
    c("POST", `/v1/me/class-courses/${ref}/${id}/complete`, { answers, reflections });
  const load = async (c: Call, name: string) =>
    ((await c("GET", "/v1/workforce")).json() as WorkforceOverview).teachers.find(
      (x) => x.name === name,
    )!;
  const A2 = "A2 Morning — Mon/Wed";
  const B1 = "B1 Evening — Tue/Thu";

  it("overview: staff see their courses:link centers, a teacher their own classes, others nothing", async () => {
    const sam = await overview(await as(SAM));
    expect(sam.role).toBe("staff");
    expect(sam.canLink).toBe(true);
    expect(sam.classes.map((c) => c.name)).toEqual(["A2 Evening — Tue/Thu", A2, B1]);
    expect(
      sam.links.map((l) => [l.id, l.className, l.course.ref, l.status, l.mineToDecide]),
    ).toEqual([
      ["SL-2", B1, "CS-B1-SPEAK", "proposed", true],
      ["SL-1", A2, "CS-A2-EVERYDAY", "linked", false],
    ]);
    expect(sam.links[1].course).toMatchObject({ version: 2, lessons: 3, linkable: true });
    const tara = await overview(await as(TARA));
    expect([tara.role, tara.canLink, tara.classes.map((c) => c.name)]).toEqual([
      "teacher",
      false,
      [A2, B1],
    ]);
    expect(tara.links.every((l) => !l.mineToDecide)).toBe(true);
    const ben = await overview(await as(BEN));
    expect([ben.classes.map((c) => c.name), ben.links]).toEqual([["A2 Evening — Tue/Thu"], []]);
    expect((await (await as(LINH))("GET", "/v1/class-courses")).statusCode).toBe(403);
    // The front-desk policy links in District 1 only: B1 Evening (Thu Duc) leaves the view.
    state.attachments.set(SAM, "policy-front-desk-d1");
    const d1 = await overview(await as(SAM));
    expect(d1.classes.map((c) => c.name)).toEqual(["A2 Evening — Tue/Thu", A2]);
    expect(d1.links.map((l) => l.id)).toEqual(["SL-1"]);
    const lumen = await overview(await as(LUMEN_STAFF, LUMEN));
    expect([lumen.classes.map((c) => c.name), lumen.links]).toEqual([["Starter — Sat"], []]);
  });

  it("search: teachers find published courses and their own; staff every course", async () => {
    const refs = async (c: Call, q = "") =>
      (
        (
          await c("GET", `/v1/class-courses/search?q=${encodeURIComponent(q)}`)
        ).json() as StudioCourse[]
      ).map((x) => [x.ref, x.linkable]);
    expect(await refs(await as(TARA))).toEqual([
      ["CS-A2-EVERYDAY", true],
      ["CS-B1-SPEAK", true],
      ["CS-IELTS-W1", true],
    ]);
    expect((await refs(await as(BEN))).map(([r]) => r)).toContain("CS-A2-PHONICS");
    expect(await refs(await as(SAM), "ielts")).toEqual([["CS-IELTS-W1", true]]);
    expect((await refs(await as(SAM))).at(-1)).toEqual(["CS-A2-PHONICS", false]);
  });

  it("propose: only the class teacher, only a published course, never twice", async () => {
    const tara = await as(TARA);
    const p = (c: Call, classId: string, courseRef: string) =>
      c("POST", "/v1/class-courses/propose", { classId, courseRef });
    expect((await p(tara, B1E, "CS-IELTS-W1")).json()).toEqual({ ok: true });
    const again = await p(tara, B1E, "CS-IELTS-W1");
    expect([again.statusCode, again.json().detail]).toEqual([409, "already proposed"]);
    const linked = await p(tara, A2M, "CS-A2-EVERYDAY");
    expect([linked.statusCode, linked.json().detail]).toEqual([
      409,
      "already linked to this class",
    ]);
    const notMine = await p(await as(BEN), B1E, "CS-IELTS-W1");
    expect([notMine.statusCode, notMine.json().reason]).toEqual([403, "not_allowed"]);
    const unpublished = await p(await as(BEN), A2E, "CS-A2-PHONICS");
    expect([unpublished.statusCode, unpublished.json().reason]).toEqual([409, "invalid_step"]);
    const hidden = await p(tara, B1E, "CS-A2-PHONICS"); // Ben's, never published
    expect([hidden.statusCode, hidden.json().reason]).toEqual([404, "not_found"]);
    const staff = await p(await as(SAM), B1E, "CS-IELTS-W1");
    expect([staff.statusCode, staff.json().reason]).toEqual([403, "not_allowed"]);
    const l = (await overview(tara)).links.find((x) => x.course.ref === "CS-IELTS-W1")!;
    expect([l.id, l.status, l.proposedBy]).toEqual(["SL-3", "proposed", "Tara"]);
  });

  it("link: staff with courses:link at the class's center; the proposal becomes the link; prep hours count in Workforce", async () => {
    const sam = await as(SAM);
    const before = await load(sam, "Tara");
    const link = (c: Call, classId: string, courseRef: string, h: unknown) =>
      c("POST", "/v1/class-courses/link", { classId, courseRef, prepHoursPerWeek: h });
    const bad = await link(sam, B1E, "CS-B1-SPEAK", 11);
    expect([bad.statusCode, bad.json().reason]).toEqual([422, "invalid"]);
    const teacher = await link(await as(TARA), B1E, "CS-B1-SPEAK", 1);
    expect([teacher.statusCode, teacher.json().reason]).toEqual([403, "not_allowed"]);
    expect((await link(sam, B1E, "CS-B1-SPEAK", 1.3)).json()).toEqual({ ok: true });
    const o = await overview(sam);
    const l = o.links.find((x) => x.classId === B1E)!;
    expect([l.id, l.status, l.prepHoursPerWeek, l.decidedBy, l.proposedBy]).toEqual([
      "SL-2",
      "linked",
      1.5,
      "Sam (Org Staff)",
      "Tara",
    ]);
    const after = await load(sam, "Tara");
    expect(after.hours).toBeCloseTo(before.hours + 1.5, 5);
    expect(after.sessions).toBe(before.sessions);
    expect(after.breakdown.find((x) => x.kind === "prep")).toEqual({
      label: B1,
      kind: "prep",
      sessions: 0,
      hours: 1.5,
    });
    const twice = await link(sam, B1E, "CS-IELTS-W1", 0);
    expect([twice.statusCode, twice.json().detail]).toEqual([
      409,
      "the class already follows a course — unlink it first",
    ]);
    const draft = await link(sam, A2E, "CS-A2-PHONICS", 0);
    expect([draft.statusCode, draft.json().reason]).toEqual([409, "invalid_step"]);
    // Front desk links in District 1 only: B1 Evening (Thu Duc) is refused, A2 Evening is fine.
    state.attachments.set(SAM, "policy-front-desk-d1");
    const d1 = await as(SAM);
    const thuDuc = await d1("POST", "/v1/class-courses/SL-2/unlink", { reason: "Wrong course" });
    expect([thuDuc.statusCode, thuDuc.json().reason]).toEqual([403, "access_policy"]);
    const linkThuDuc = await link(d1, B1E, "CS-IELTS-W1", 0);
    expect([linkThuDuc.statusCode, linkThuDuc.json().reason]).toEqual([403, "access_policy"]);
    expect((await link(d1, A2E, "CS-IELTS-W1", 0)).json()).toEqual({ ok: true });
    // The course page names the classes that follow it.
    const det = (
      await (
        await as(OLIVIA)
      )("GET", "/v1/courses/CS-B1-SPEAK")
    ).json() as AuthoredCourseDetail;
    expect(det.linkedClasses).toEqual([B1]);
  });

  it("reject / unlink need a reason; prep only on a linked course; decisions belong to staff", async () => {
    const sam = await as(SAM);
    const step = (c: Call, id: string, s: string, body: object) =>
      c("POST", `/v1/class-courses/${id}/${s}`, body);
    const short = await step(sam, "SL-2", "reject", { reason: "no" });
    expect([short.statusCode, short.json().reason]).toEqual([422, "invalid"]);
    const tara = await step(await as(TARA), "SL-2", "reject", { reason: "Changed my mind" });
    expect([tara.statusCode, tara.json().reason]).toEqual([403, "access_policy"]);
    expect((await step(sam, "SL-2", "reject", { reason: "Use the IELTS course" })).json()).toEqual({
      ok: true,
    });
    const again = await step(sam, "SL-2", "reject", { reason: "Use the IELTS course" });
    expect([again.statusCode, again.json().reason]).toEqual([409, "invalid_step"]);
    const rej = (await overview(sam)).links.find((l) => l.id === "SL-2")!;
    expect([rej.status, rej.reason, rej.decidedBy]).toEqual([
      "rejected",
      "Use the IELTS course",
      "Sam (Org Staff)",
    ]);
    const noReason = await step(sam, "SL-1", "unlink", {});
    expect([noReason.statusCode, noReason.json().reason]).toEqual([422, "invalid"]);
    expect((await step(sam, "SL-1", "prep", { hours: 2 })).json()).toEqual({ ok: true });
    expect((await load(sam, "Tara")).breakdown.find((x) => x.kind === "prep")?.hours).toBe(2);
    const tooMany = await step(sam, "SL-1", "prep", { hours: 10.5 });
    expect([tooMany.statusCode, tooMany.json().reason]).toEqual([422, "invalid"]);
    expect((await step(sam, "SL-1", "unlink", { reason: "Term ended" })).json()).toEqual({
      ok: true,
    });
    expect((await load(sam, "Tara")).breakdown.some((x) => x.kind === "prep")).toBe(false);
    const prep = await step(sam, "SL-1", "prep", { hours: 1 });
    expect([prep.statusCode, prep.json().reason]).toEqual([409, "invalid_step"]);
    // Unlinked: the class's learners no longer have the course in My Learning.
    expect(await mine(await as(LINH))).toEqual([]);
    const gone = await step(sam, "SL-99", "unlink", { reason: "Term ended" });
    expect([gone.statusCode, gone.json().reason]).toEqual([404, "not_found"]);
  });

  it("progress: lessons of the version each learner is on, for the class's staff and teacher", async () => {
    const rows = (await (
      await (
        await as(SAM)
      )("GET", "/v1/class-courses/SL-1/progress")
    ).json()) as LearnerStudioProgress[];
    expect(rows.map((r) => [r.name, r.completedLessons, r.totalLessons, r.pct, r.version])).toEqual(
      [
        ["An P.", 1, 2, 50, 1],
        ["Linh N.", 0, 3, 0, 2],
        ["Minh T.", 0, 3, 0, 2],
      ],
    );
    expect(rows[0].lastActivityAt).not.toBeNull();
    expect((await (await as(TARA))("GET", "/v1/class-courses/SL-1/progress")).statusCode).toBe(200);
    expect((await (await as(BEN))("GET", "/v1/class-courses/SL-1/progress")).statusCode).toBe(404);
    expect((await (await as(SAM))("GET", "/v1/class-courses/SL-2/progress")).statusCode).toBe(404); // proposed
  });

  it("My Learning: the class course, answers hidden until done, every question and reflection answered", async () => {
    const linh = await as(LINH);
    const [m] = await mine(linh);
    expect(m).toMatchObject({
      ref: "CS-A2-EVERYDAY",
      className: A2,
      version: 2,
      latestVersion: 2,
      completedLessons: 0,
      pct: 0,
    });
    expect(m.lessons.map((l) => l.lessonId)).toEqual(["a2-l1", "a2-l2", "a2-l3"]);
    const l1 = await lesson(linh, "CS-A2-EVERYDAY", "a2-l1");
    const quiz = l1.lesson.blocks.find((b) => b.kind === "quiz") as { correct: number };
    expect([l1.index, l1.total, quiz.correct, l1.completed]).toEqual([0, 3, -1, null]);
    const missing = await complete(linh, "CS-A2-EVERYDAY", "a2-l1", {});
    expect([missing.statusCode, missing.json().detail]).toEqual([422, "answer every question"]);
    const outside = await complete(linh, "CS-A2-EVERYDAY", "a2-l1", {
      "a2-l1-b4": 1,
      "b1-l1-b3": 0,
    });
    expect([outside.statusCode, outside.json().reason]).toEqual([422, "invalid"]);
    const range = await complete(linh, "CS-A2-EVERYDAY", "a2-l1", { "a2-l1-b4": 3 });
    expect([range.statusCode, range.json().reason]).toEqual([422, "invalid"]);
    expect((await complete(linh, "CS-A2-EVERYDAY", "a2-l1", { "a2-l1-b4": 1 })).json()).toEqual({
      ok: true,
      score: 100,
    });
    const done = await lesson(linh, "CS-A2-EVERYDAY", "a2-l1");
    expect((done.lesson.blocks.find((b) => b.kind === "quiz") as { correct: number }).correct).toBe(
      1,
    );
    expect(done.completed).toMatchObject({ score: 100, answers: { "a2-l1-b4": 1 } });
    const twice = await complete(linh, "CS-A2-EVERYDAY", "a2-l1", { "a2-l1-b4": 1 });
    expect([twice.statusCode, twice.json().reason]).toEqual([409, "invalid_step"]);
    // Lesson 2 has a reflection: it must be written; a wrong answer scores 0.
    const noText = await complete(
      linh,
      "CS-A2-EVERYDAY",
      "a2-l2",
      { "a2-l2-b3": 1 },
      { "a2-l2-b4": "  " },
    );
    expect([noText.statusCode, noText.json().detail]).toEqual([
      422,
      "write something for each reflection",
    ]);
    expect(
      (
        await complete(
          linh,
          "CS-A2-EVERYDAY",
          "a2-l2",
          { "a2-l2-b3": 1 },
          { "a2-l2-b4": "By bus." },
        )
      ).json(),
    ).toEqual({ ok: true, score: 0 });
    const [after] = await mine(linh);
    expect([after.completedLessons, after.pct, after.lessons.map((l) => l.score)]).toEqual([
      2,
      67,
      [100, 0, null],
    ]);
    // Not open to Linh: the B1 course (not her class) — and only learners use My Learning.
    expect((await linh("GET", "/v1/me/class-courses/CS-B1-SPEAK/b1-l1")).statusCode).toBe(404);
    const tara = await complete(await as(TARA), "CS-A2-EVERYDAY", "a2-l1", { "a2-l1-b4": 1 });
    expect([tara.statusCode, tara.json().reason]).toEqual([403, "not_allowed"]);
    expect((await (await as(TARA))("GET", "/v1/me/class-courses")).statusCode).toBe(403);
  });

  it("pinned: a learner stays on the version of their first completed lesson", async () => {
    // An started on v1 (2 lessons) and stays there, though v2 has 3.
    const an = await ownerQuery(`select principal_id from learner where id = '${L(3)}'`);
    expect(an.rows[0].principal_id).toBeNull(); // An does not sign in: check through the progress view
    const linh = await as(LINH);
    await complete(linh, "CS-A2-EVERYDAY", "a2-l1", { "a2-l1-b4": 1 });
    // Tara edits the A2 course; Olivia publishes v3 with a fourth lesson.
    const tara = await as(TARA);
    const d = (await (
      await tara("GET", "/v1/courses/CS-A2-EVERYDAY")
    ).json()) as AuthoredCourseDetail;
    const content = {
      ...d.draft,
      lessons: [
        ...d.draft.lessons,
        {
          id: "a2-l4",
          title: "Review",
          blocks: [{ id: "a2-l4-b1", kind: "text", text: "Revise." }],
        },
      ],
    };
    expect(
      (
        await tara("POST", "/v1/courses/CS-A2-EVERYDAY/draft", {
          content,
          baseRevision: d.draftRevision,
        })
      ).json().ok,
    ).toBe(true);
    expect((await tara("POST", "/v1/courses/CS-A2-EVERYDAY/submit", {})).json().ok).toBe(true);
    expect(
      (await (await as(OLIVIA))("POST", "/v1/courses/CS-A2-EVERYDAY/approve", {})).json().ok,
    ).toBe(true);
    const [l] = await mine(linh);
    expect([l.version, l.latestVersion, l.lessons.length]).toEqual([2, 3, 3]);
    const [m] = await mine(await as(MINH)); // no lesson done yet → the latest
    expect([m.version, m.lessons.length]).toEqual([3, 4]);
    expect((await linh("GET", "/v1/me/class-courses/CS-A2-EVERYDAY/a2-l4")).statusCode).toBe(404);
    const rows = (await (
      await (
        await as(SAM)
      )("GET", "/v1/class-courses/SL-1/progress")
    ).json()) as LearnerStudioProgress[];
    expect(rows.map((r) => [r.name, r.completedLessons, r.totalLessons, r.version])).toEqual([
      ["An P.", 1, 2, 1],
      ["Linh N.", 1, 3, 2],
      ["Minh T.", 0, 4, 3],
    ]);
  });

  it("completed lessons and pins cannot be changed: no grant for the application, a trigger for the owner", async () => {
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    try {
      for (const q of [
        "update course_lesson_done set score = 0",
        "delete from course_lesson_done",
        "update course_progress set version = 2",
        "delete from class_course_link",
      ]) {
        await app.query("begin");
        await app.query("select set_config('app.org_id', $1, true)", [NOVA]);
        await expect(app.query(q)).rejects.toThrow(/permission denied/);
        await app.query("rollback");
      }
    } finally {
      await app.end();
    }
    await expect(ownerQuery("update course_lesson_done set score = 0")).rejects.toThrow(
      /immutable/,
    );
    await expect(ownerQuery("update course_progress set version = 2")).rejects.toThrow(/immutable/);
  });
});
