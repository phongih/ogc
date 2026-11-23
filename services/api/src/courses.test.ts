// Course Studio on the Platform API (slice 3 part A): who reads and edits which course, draft
// saves with revisions, submit → a DIFFERENT person approves → an immutable published version,
// returns and withdrawals, the access policy, tenant isolation and immutability in the database.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type { AuthoredCourseDetail, AuthoredCourseSummary, CourseContent } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "course-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-23T05:00:00Z");
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const TARA = "iios-principal-teacher-1";
const BEN = "iios-principal-teacher-2";
const LINH = "iios-principal-learner-1";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `crs-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("course studio — API", () => {
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
  const list = async (c: Call) =>
    (await c("GET", "/v1/courses")).json() as {
      courses: AuthoredCourseSummary[];
      canCreate: boolean;
    };
  const detail = async (c: Call, ref: string) =>
    (await c("GET", `/v1/courses/${ref}`)).json() as AuthoredCourseDetail;
  const save = async (c: Call, ref: string, content: CourseContent, baseRevision: number) =>
    c("POST", `/v1/courses/${ref}/draft`, { content, baseRevision });
  const step = (c: Call, ref: string, s: string, note?: string) =>
    c("POST", `/v1/courses/${ref}/${s}`, note === undefined ? {} : { note });
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
  const withLesson = (c: CourseContent, id: string): CourseContent => ({
    ...c,
    lessons: [
      ...c.lessons,
      { id, title: `Lesson ${id}`, blocks: [{ id: `${id}-b1`, kind: "text", text: "Read this." }] },
    ],
  });

  it("lists by role: staff see every course of their org, teachers their own and published ones", async () => {
    const o = await list(await as(OLIVIA));
    expect(o.canCreate).toBe(true);
    expect(Object.fromEntries(o.courses.map((c) => [c.ref, c.status]))).toEqual({
      "CS-A2-EVERYDAY": "published",
      "CS-B1-SPEAK": "unpublished_changes",
      "CS-IELTS-W1": "published",
      "CS-A2-PHONICS": "in_review",
    });
    expect(o.courses.find((c) => c.ref === "CS-A2-PHONICS")).toMatchObject({
      canReview: true,
      publishedVersion: null,
      lessons: 0,
      ownerName: "Ben",
    });
    expect(o.courses.find((c) => c.ref === "CS-A2-EVERYDAY")).toMatchObject({
      publishedVersion: 2,
      lessons: 3,
      canEdit: true,
    });

    const tara = await list(await as(TARA));
    expect(tara.canCreate).toBe(true);
    expect(tara.courses.map((c) => [c.ref, c.canEdit, c.canReview]).sort()).toEqual([
      ["CS-A2-EVERYDAY", true, false],
      ["CS-B1-SPEAK", true, false],
      ["CS-IELTS-W1", false, false],
    ]);
    // Ben's never-published course is his only.
    expect((await list(await as(BEN))).courses.map((c) => c.ref).sort()).toEqual([
      "CS-A2-EVERYDAY",
      "CS-A2-PHONICS",
      "CS-B1-SPEAK",
      "CS-IELTS-W1",
    ]);
    expect((await (await as(LINH))("GET", "/v1/courses")).statusCode).toBe(403);
    expect((await list(await as(LUMEN_STAFF, LUMEN))).courses.map((c) => c.ref)).toEqual([
      "CS-LUMEN-STARTER",
    ]);
  });

  it("a teacher reading someone else's course sees the published version, never the draft", async () => {
    const ben = await detail(await as(BEN), "CS-B1-SPEAK");
    expect(ben.canEdit).toBe(false);
    expect(ben.draft.lessons).toHaveLength(2); // v1, not Tara's third lesson
    const tara = await detail(await as(TARA), "CS-B1-SPEAK");
    expect(tara.draft.lessons).toHaveLength(3);
    expect(tara.editorsSinceLastPublication).toEqual(["Tara"]);
    expect(tara.versions.map((v) => v.version)).toEqual([1]);
    expect((await (await as(TARA))("GET", "/v1/courses/CS-A2-PHONICS")).statusCode).toBe(404);
    // Staff see a pending submission; a reading teacher does not.
    expect((await detail(await as(SAM), "CS-A2-PHONICS")).pending).toMatchObject({
      submittedBy: "Ben",
    });
    const a2 = await detail(await as(OLIVIA), "CS-A2-EVERYDAY");
    expect(a2.reviews.map((r) => r.action)).toEqual([
      "approved",
      "submitted",
      "returned",
      "submitted",
      "approved",
      "submitted",
    ]);
    expect(a2.reviews[2].note).toBe("Add a quiz to “Making plans”.");
  });

  it("create: teachers and staff with courses:author; a numbered code; the creator is an editor", async () => {
    const tara = await as(TARA);
    const r = await tara("POST", "/v1/courses", { title: "A1 Numbers", level: "A1" });
    expect(r.json()).toEqual({ ok: true, ref: "CS-005", revision: 1 });
    const d = await detail(tara, "CS-005");
    expect(d).toMatchObject({ status: "draft", canEdit: true, ownerName: "Tara" });
    expect(d.editorsSinceLastPublication).toEqual(["Tara"]);
    // Ben cannot edit Tara's course (and cannot even read it — never published).
    expect((await (await as(BEN))("GET", "/v1/courses/CS-005")).statusCode).toBe(404);

    const linh = await (await as(LINH))("POST", "/v1/courses", { title: "Nope", level: "A1" });
    expect([linh.statusCode, linh.json().reason]).toEqual([403, "not_allowed"]);
    const bad = await tara("POST", "/v1/courses", { title: "x", level: "A1" });
    expect([bad.statusCode, bad.json().reason]).toEqual([422, "invalid"]);
    // Same idempotency key → the same answer, no second course.
    const sam = await as(SAM);
    const k = key();
    const a = (await sam("POST", "/v1/courses", { title: "Staff course", level: "B2" }, k)).json();
    const b = await sam("POST", "/v1/courses", { title: "Staff course", level: "B2" }, k);
    expect(b.headers["idempotent-replay"]).toBe("true");
    expect(b.json()).toEqual(a);
    expect((await list(sam)).courses).toHaveLength(6);
  });

  it("the access policy decides authoring: Sam on the front-desk policy cannot write or review", async () => {
    state.attachments.set(SAM, "policy-front-desk-d1"); // no courses:author rule
    const sam = await as(SAM);
    expect((await list(sam)).canCreate).toBe(false);
    const c = await sam("POST", "/v1/courses", { title: "Staff course", level: "B2" });
    expect([c.statusCode, c.json().reason]).toEqual([403, "access_policy"]);
    const ph = await detail(sam, "CS-A2-PHONICS");
    expect(ph.canReview).toBe(false);
    expect(ph.reviewBlockedReason).toMatch(/access policy/);
    const a = await step(sam, "CS-A2-PHONICS", "approve");
    expect([a.statusCode, a.json().reason]).toEqual([403, "access_policy"]);
    const ielts = await detail(sam, "CS-IELTS-W1");
    const s = await save(sam, "CS-IELTS-W1", withLesson(ielts.draft, "x1"), ielts.draftRevision);
    expect([s.statusCode, s.json().reason]).toEqual([403, "access_policy"]);
  });

  it("saves: revision-checked, own courses for teachers, validated, unknown keys dropped", async () => {
    const tara = await as(TARA);
    const d = await detail(tara, "CS-B1-SPEAK");
    expect(d.draftRevision).toBe(4);
    const next = withLesson(d.draft, "b1-l4");
    const ok = await save(tara, "CS-B1-SPEAK", next, 4);
    expect(ok.json()).toEqual({ ok: true, revision: 5 });
    const stale = await save(tara, "CS-B1-SPEAK", withLesson(next, "b1-l5"), 4);
    expect([stale.statusCode, stale.json().reason]).toEqual([409, "conflict"]);

    // The same content with keys in another order is not a change.
    const shuffled = JSON.parse(
      JSON.stringify(next, (_k, v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? Object.fromEntries(Object.entries(v).reverse())
          : v,
      ),
    ) as CourseContent;
    expect((await save(tara, "CS-B1-SPEAK", shuffled, 5)).json()).toEqual({
      ok: true,
      revision: 5,
    });

    const ben = await save(await as(BEN), "CS-B1-SPEAK", next, 5);
    expect([ben.statusCode, ben.json().reason]).toEqual([403, "not_allowed"]);
    const evil = {
      ...next,
      lessons: [{ ...next.lessons[0], blocks: [{ id: "z", kind: "html", html: "<b>" }] }],
    } as unknown as CourseContent;
    const inv = await save(tara, "CS-B1-SPEAK", evil, 5);
    expect([inv.statusCode, inv.json().reason]).toEqual([422, "invalid"]);
    const extra = { ...next, secret: "x", lessons: next.lessons.map((l) => ({ ...l, x: 1 })) };
    expect((await save(tara, "CS-B1-SPEAK", extra as CourseContent, 5)).json().ok).toBe(true);
    const stored = (await detail(tara, "CS-B1-SPEAK")).draft as unknown as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["lessons", "level", "summary", "title"]);
    expect(Object.keys((stored.lessons as object[])[0]).sort()).toEqual(["blocks", "id", "title"]);
    // Staff edit every course of the org — and become an editor of that draft.
    const sam = await as(SAM);
    const s = await detail(sam, "CS-B1-SPEAK");
    expect(
      (await save(sam, "CS-B1-SPEAK", withLesson(s.draft, "b1-sam"), s.draftRevision)).json(),
    ).toMatchObject({ ok: true });
    expect((await detail(sam, "CS-B1-SPEAK")).editorsSinceLastPublication).toEqual([
      "Tara",
      "Sam (Org Staff)",
    ]);
  });

  it("a course too large for one draft is refused", async () => {
    const tara = await as(TARA);
    const d = await detail(tara, "CS-B1-SPEAK");
    const big: CourseContent = {
      ...d.draft,
      lessons: Array.from({ length: 10 }, (_, i) => ({
        id: `big-${i}`,
        title: `Big ${i}`,
        blocks: Array.from({ length: 12 }, (_, j) => ({
          id: `big-${i}-${j}`,
          kind: "text" as const,
          text: "a".repeat(1900),
        })),
      })),
    };
    const r = await save(tara, "CS-B1-SPEAK", big, d.draftRevision);
    expect([r.statusCode, r.json().detail]).toEqual([422, "the course is too large"]);
  });

  it("submit → another staff member approves → an immutable new version; the draft is published", async () => {
    const tara = await as(TARA);
    expect((await step(tara, "CS-B1-SPEAK", "submit")).json()).toEqual({ ok: true });
    const d = await detail(tara, "CS-B1-SPEAK");
    expect(d.status).toBe("in_review");
    const blocked = await save(tara, "CS-B1-SPEAK", withLesson(d.draft, "x"), d.draftRevision);
    expect([blocked.statusCode, blocked.json().reason]).toEqual([409, "invalid_step"]);
    const again = await step(tara, "CS-B1-SPEAK", "submit");
    expect([again.statusCode, again.json().reason]).toEqual([409, "invalid_step"]);
    // A teacher never approves.
    const ta = await step(tara, "CS-B1-SPEAK", "approve");
    expect([ta.statusCode, ta.json().reason]).toEqual([403, "not_allowed"]);
    const bena = await step(await as(BEN), "CS-B1-SPEAK", "approve");
    expect([bena.statusCode, bena.json().reason]).toEqual([403, "not_allowed"]);

    now += 60_000;
    const sam = await as(SAM);
    expect((await step(sam, "CS-B1-SPEAK", "approve", "Looks good")).json()).toEqual({ ok: true });
    const p = await detail(sam, "CS-B1-SPEAK");
    expect(p).toMatchObject({
      status: "published",
      publishedVersion: 2,
      lessons: 3,
      pending: null,
    });
    expect(p.editorsSinceLastPublication).toEqual([]);
    expect(p.versions.map((v) => [v.version, v.submittedBy, v.approvedBy, v.note])).toEqual([
      [2, "Tara", "Sam (Org Staff)", "Looks good"],
      [1, "Tara", "Sam (Org Staff)", null],
    ]);
    expect(p.versions[1].content.lessons).toHaveLength(2); // v1 unchanged
    expect(p.reviews[0]).toMatchObject({ action: "approved", version: 2, by: "Sam (Org Staff)" });
    // A reading teacher now sees v2.
    expect((await detail(await as(BEN), "CS-B1-SPEAK")).draft.lessons).toHaveLength(3);
    // Nothing changed since → nothing to submit.
    const none = await step(tara, "CS-B1-SPEAK", "submit");
    expect([none.statusCode, none.json().detail]).toEqual([
      409,
      "nothing changed since the last publication",
    ]);
  });

  it("never your own step: the submitter and anyone who edited the draft cannot approve", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    // Sam edits Tara's draft; Tara submits; Sam may not approve, Olivia may.
    const s = await detail(sam, "CS-B1-SPEAK");
    await save(sam, "CS-B1-SPEAK", withLesson(s.draft, "b1-sam"), s.draftRevision);
    await step(await as(TARA), "CS-B1-SPEAK", "submit");
    const r = await step(sam, "CS-B1-SPEAK", "approve");
    expect([r.statusCode, r.json().reason, r.json().detail]).toEqual([
      403,
      "own_step",
      "you edited this draft — someone else approves",
    ]);
    expect((await detail(sam, "CS-B1-SPEAK")).canReview).toBe(false);
    expect((await detail(olivia, "CS-B1-SPEAK")).canReview).toBe(true);
    // Sam's own course: Sam submits, Sam may not approve (nor return).
    const i = await detail(sam, "CS-IELTS-W1");
    await save(sam, "CS-IELTS-W1", withLesson(i.draft, "iw-l3"), i.draftRevision);
    // the editor list was cleared at v1, so Sam is an editor again only by this save
    await step(sam, "CS-IELTS-W1", "submit");
    const own = await step(sam, "CS-IELTS-W1", "return", "Needs more");
    expect([own.statusCode, own.json().reason]).toEqual([403, "own_step"]);
    expect((await step(olivia, "CS-IELTS-W1", "approve")).json().ok).toBe(true);
    // The submitter alone is blocked too, even without having edited since.
    await ownerQuery(
      `update authored_course set editors = '[]', pending_by = '${SAM}' where ref = 'CS-A2-PHONICS'`,
    );
    const ph = await step(sam, "CS-A2-PHONICS", "approve");
    expect([ph.statusCode, ph.json().detail]).toEqual([
      403,
      "you submitted it — someone else approves",
    ]);
    expect((await step(olivia, "CS-A2-PHONICS", "approve")).json().ok).toBe(true);
  });

  it("return needs a note and sends the course back to draft; withdraw lets the author edit again", async () => {
    const olivia = await as(OLIVIA);
    const short = await step(olivia, "CS-A2-PHONICS", "return", "no");
    expect([short.statusCode, short.json().reason]).toEqual([422, "invalid"]);
    const long = await step(olivia, "CS-A2-PHONICS", "approve", "x".repeat(301));
    expect([long.statusCode, long.json().reason]).toEqual([422, "invalid"]);
    expect((await step(olivia, "CS-A2-PHONICS", "return", "Add a second lesson")).json()).toEqual({
      ok: true,
    });
    const ben = await as(BEN);
    const d = await detail(ben, "CS-A2-PHONICS");
    expect(d.status).toBe("draft");
    expect(d.reviews[0]).toMatchObject({ action: "returned", note: "Add a second lesson" });
    expect(
      (await save(ben, "CS-A2-PHONICS", withLesson(d.draft, "ph-l2"), d.draftRevision)).json(),
    ).toMatchObject({ ok: true });
    expect((await step(ben, "CS-A2-PHONICS", "submit")).json().ok).toBe(true);
    expect((await step(ben, "CS-A2-PHONICS", "withdraw")).json().ok).toBe(true);
    const w = await detail(ben, "CS-A2-PHONICS");
    expect([w.status, w.reviews[0].action]).toEqual(["draft", "withdrawn"]);
    const nothing = await step(ben, "CS-A2-PHONICS", "withdraw");
    expect([nothing.statusCode, nothing.json().reason]).toEqual([409, "invalid_step"]);
    const nr = await step(olivia, "CS-A2-PHONICS", "approve");
    expect([nr.statusCode, nr.json().reason]).toEqual([409, "invalid_step"]);
  });

  it("submit checks every required field (submit mode), drafts may be incomplete", async () => {
    const tara = await as(TARA);
    const d = await detail(tara, "CS-B1-SPEAK");
    const half: CourseContent = {
      ...d.draft,
      lessons: [
        ...d.draft.lessons,
        {
          id: "b1-q",
          title: "Quiz",
          blocks: [{ id: "b1-q1", kind: "quiz", question: "", options: ["", ""], correct: 0 }],
        },
      ],
    };
    expect((await save(tara, "CS-B1-SPEAK", half, d.draftRevision)).json().ok).toBe(true);
    const s = await step(tara, "CS-B1-SPEAK", "submit");
    expect([s.statusCode, s.json().reason]).toEqual([422, "invalid"]);
    expect(s.json().detail).toMatch(/question is empty/);
  });

  it("tenant isolation: another organization's course is not found", async () => {
    expect(
      (await (await as(LUMEN_STAFF, LUMEN))("GET", "/v1/courses/CS-A2-EVERYDAY")).statusCode,
    ).toBe(404);
    expect((await (await as(OLIVIA))("GET", "/v1/courses/CS-LUMEN-STARTER")).statusCode).toBe(404);
    const r = await step(await as(OLIVIA), "CS-LUMEN-STARTER", "submit");
    expect([r.statusCode, r.json().reason]).toEqual([404, "not_found"]);
  });

  it("published versions cannot be changed: no grant for the application, a trigger for the owner", async () => {
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    try {
      await app.query("begin");
      await app.query("select set_config('app.org_id', $1, true)", [NOVA]);
      await expect(
        app.query("update course_version set note = 'x' where course_ref = 'CS-A2-EVERYDAY'"),
      ).rejects.toThrow(/permission denied/);
      await app.query("rollback");
      await app.query("begin");
      await app.query("select set_config('app.org_id', $1, true)", [NOVA]);
      await expect(app.query("delete from course_review")).rejects.toThrow(/permission denied/);
      await app.query("rollback");
    } finally {
      await app.end();
    }
    await expect(
      ownerQuery("update course_version set content = '{}' where course_ref = 'CS-A2-EVERYDAY'"),
    ).rejects.toThrow(/immutable/);
  });
});
