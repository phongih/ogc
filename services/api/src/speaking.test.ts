import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import type {
  EngineEvent,
  LearnerProfile,
  MyLessonView,
  Rule,
  SpeakingReviewQueue,
  StudentCard,
} from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { L, LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "speak-test-secret-0123456789abcde";
const NOW = Date.parse("2026-11-23T05:00:00Z");
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const BEN = "iios-principal-teacher-2";
const LINH = "iios-principal-learner-1";
const MINH = "iios-principal-learner-2";
const LUMEN_STAFF = "iios-principal-staff-org2";
const DAY = 86_400_000;
let seq = 0;
const key = () => `spk-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("speaking review — API", () => {
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
  const run = (c: Call) => c("POST", "/v1/engine/run");
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
  const REF = "CS-A2-EVERYDAY";
  const BLOCK = "a2-l3-b5";
  const queue = async (c: Call) =>
    (await c("GET", "/v1/speaking-reviews")).json() as SpeakingReviewQueue;
  const lesson = async (c: Call, id = "a2-l3") =>
    (await c("GET", `/v1/me/class-courses/${REF}/${id}`)).json() as MyLessonView;
  const decide = (c: Call, attempt: number, decision: string, note?: string, learner = L(1)) =>
    c("POST", "/v1/speaking-reviews/decide", {
      learnerId: learner,
      ref: REF,
      lessonId: "a2-l3",
      blockId: BLOCK,
      attempt,
      decision,
      ...(note !== undefined ? { note } : {}),
    });
  const retry = (c: Call, choices: unknown) =>
    c("POST", `/v1/me/class-courses/${REF}/a2-l3/speaking/${BLOCK}`, { choices });
  const card = async (c: Call, name: string) =>
    ((await c("GET", "/v1/students")).json() as StudentCard[]).find((x) => x.name === name)!;
  const skills = async (c: Call) => (await c("GET", "/v1/me/skills")).json() as LearnerProfile;
  const events = async (c: Call) => (await c("GET", "/v1/engine/events")).json() as EngineEvent[];
  const spokenEvents = async () =>
    (await events(await as(SAM)))
      .filter((e) => e.kind === "speaking_returned")
      .map((e) => [e.subject.label, e.evidence]);

  it("the queue: the class teacher reviews Linh's rehearsal; staff only see it; others nothing", async () => {
    const tara = await queue(await as(TARA));
    expect(tara.mayReview).toBe(true);
    expect(tara.items).toHaveLength(1);
    expect(tara.items[0]).toMatchObject({
      learnerId: L(1),
      learnerName: "Linh N.",
      className: "A2 Morning — Mon/Wed",
      ref: REF,
      version: 2,
      lessonId: "a2-l3",
      lessonTitle: "Making plans",
      blockId: BLOCK,
      attempt: 1,
      scenario: "Describe your weekend",
      score: 75,
    });
    expect(tara.items[0].turns.map((t) => [t.chosen, t.natural])).toEqual([
      ["It was great, thanks! I went to the beach.", true],
      ["I went with my cousin and her friends.", true],
      ["We swim and eat seafood tomorrow.", false],
      ["Definitely — maybe next month.", true],
    ]);
    expect(tara.items[0].turns[2].model).toBe("We swam in the morning and had seafood for lunch.");
    const sam = await queue(await as(SAM));
    expect([sam.mayReview, sam.items.length]).toEqual([false, 1]);
    expect((await queue(await as(BEN))).items).toEqual([]); // not his class
    expect((await (await as(LINH))("GET", "/v1/speaking-reviews")).statusCode).toBe(403);
    expect((await queue(await as(LUMEN_STAFF, LUMEN))).items).toEqual([]);
    expect((await card(await as(SAM), "Linh N.")).care.evidence.map((e) => e.text)).toContain(
      "Speaking is 55, below 60 (placement test only)",
    );
    // Pending: not Speaking evidence yet.
    expect((await skills(await as(LINH))).skills.speaking).toMatchObject({
      level: 55,
      evidenceCount: 0,
    });
  });

  it("completing a lesson submits each rehearsal: a reply at every turn; answers hidden until done", async () => {
    const minh = await as(MINH);
    const before = await lesson(minh);
    const b = before.lesson.blocks.find((x) => x.id === BLOCK) as {
      turns: { natural: number; model: string; tip: string }[];
    };
    expect(b.turns.map((t) => [t.natural, t.model, t.tip])).toEqual(Array(4).fill([-1, "", ""]));
    expect(before.speaking).toEqual([]);
    const post = (speaking?: object) =>
      minh("POST", `/v1/me/class-courses/${REF}/a2-l3/complete`, {
        answers: { "a2-l3-b4": 0 },
        reflections: {},
        ...(speaking !== undefined ? { speaking } : {}),
      });
    for (const bad of [
      undefined,
      { [BLOCK]: [0, 1, 2] },
      { [BLOCK]: [0, 1, 2, 3] },
      { [BLOCK]: [0, 1, 2, 0.5] },
    ]) {
      const r = await post(bad);
      expect([r.statusCode, r.json().detail]).toEqual([
        422,
        "choose a reply at every speaking turn",
      ]);
    }
    const stray = await post({ [BLOCK]: [0, 1, 2, 0], "a2-l3-b4": [0] });
    expect([stray.statusCode, stray.json().reason]).toEqual([422, "invalid"]);
    expect((await post({ [BLOCK]: [0, 1, 2, 2] })).json()).toEqual({
      ok: true,
      score: 100,
      practiceScore: null,
    });
    const after = await lesson(minh);
    expect(after.completed?.speaking).toEqual({ [BLOCK]: [0, 1, 2, 2] });
    expect(after.speaking).toMatchObject([
      {
        blockId: BLOCK,
        attempt: 1,
        choices: [0, 1, 2, 2],
        score: 75,
        status: "pending",
        note: null,
      },
    ]);
    const t = (after.lesson.blocks.find((x) => x.id === BLOCK) as { turns: { natural: number }[] })
      .turns;
    expect(t.map((x) => x.natural)).toEqual([0, 1, 2, 0]); // revealed after completion
    expect((await queue(await as(TARA))).items.map((i) => i.learnerName)).toEqual([
      "Linh N.",
      "Minh T.",
    ]);
  });

  it("return with a note → watch evidence + engine event; the learner tries again; approval counts for Speaking", async () => {
    const tara = await as(TARA);
    const sam = await as(SAM);
    const linh = await as(LINH);
    // Only the class teacher decides; a return needs a note.
    const staff = await decide(sam, 1, "approve");
    expect([staff.statusCode, staff.json().reason]).toEqual([403, "not_allowed"]);
    const ben = await decide(await as(BEN), 1, "approve");
    expect([ben.statusCode, ben.json().reason]).toEqual([403, "not_allowed"]);
    const noNote = await decide(tara, 1, "return", "  ");
    expect([noNote.statusCode, noNote.json().reason]).toEqual([422, "invalid"]);
    expect((await decide(tara, 1, "maybe")).statusCode).toBe(422);
    // Linh cannot resend before a return.
    const early = await retry(linh, [0, 1, 2, 0]);
    expect([early.statusCode, early.json().reason]).toEqual([409, "invalid_step"]);
    expect((await decide(tara, 1, "return", "Use the past tense in turn 3.")).json()).toEqual({
      ok: true,
    });
    const twice = await decide(tara, 1, "approve");
    expect([twice.statusCode, twice.json().reason]).toEqual([409, "invalid_step"]);
    expect((await queue(tara)).items).toEqual([]);
    expect((await lesson(linh)).speaking).toMatchObject([
      {
        attempt: 1,
        status: "returned",
        reviewerName: "Tara",
        note: "Use the past tense in turn 3.",
      },
    ]);
    // Returned: watch evidence in Current Students and a Decision Engine event — not a skill score.
    const c = await card(sam, "Linh N.");
    expect(c.care.evidence.find((e) => e.kind === "speaking_returned")).toEqual({
      level: "watch",
      kind: "speaking_returned",
      text: "A speaking rehearsal was returned by the teacher for another try",
    });
    expect((await run(sam)).statusCode).toBe(200);
    expect(await spokenEvents()).toEqual([
      ["Linh N. · A2 Morning — Mon/Wed", "Speaking rehearsal returned by the teacher"],
    ]);
    expect((await skills(linh)).skills.speaking.evidenceCount).toBe(0);
    // Try again: a reply at every turn.
    const bad = await retry(linh, [0, 1]);
    expect([bad.statusCode, bad.json().detail]).toEqual([
      422,
      "choose a reply at every speaking turn",
    ]);
    expect(
      (
        await (
          await as(MINH)
        )("POST", `/v1/me/class-courses/${REF}/a2-l3/speaking/${BLOCK}`, { choices: [0, 1, 2, 0] })
      ).statusCode,
    ).toBe(409); // not done the lesson
    expect((await retry(linh, [0, 1, 2, 0])).json()).toEqual({ ok: true });
    expect((await retry(linh, [0, 1, 2, 0])).statusCode).toBe(409); // now pending again
    const q = await queue(tara);
    expect(q.items.map((i) => [i.attempt, i.score])).toEqual([[2, 100]]);
    expect((await card(sam, "Linh N.")).care.evidence.map((e) => e.kind)).not.toContain(
      "speaking_returned",
    );
    // An older attempt number is refused; the current one is approved.
    expect((await decide(tara, 1, "approve")).statusCode).toBe(409);
    now += DAY;
    expect((await decide(tara, 2, "approve", "Well done.")).json()).toEqual({ ok: true });
    const p = await skills(linh);
    expect(p.skills.speaking.evidenceCount).toBe(1);
    // Current Students uses the same approved evidence: no longer "placement test only".
    const texts = (await card(sam, "Linh N.")).care.evidence.map((e) => e.text);
    expect(texts.some((x) => x.startsWith("Speaking is 55"))).toBe(false);
    expect(p.skills.speaking.level).toBeGreaterThan(55);
    expect((await lesson(linh)).speaking).toMatchObject([
      { attempt: 2, status: "approved", reviewerName: "Tara", note: "Well done." },
    ]);
    const rows = await ownerQuery(
      "select attempt, status from course_speaking_attempt order by attempt",
    );
    expect(rows.rows).toEqual([
      { attempt: 1, status: "returned" },
      { attempt: 2, status: "approved" },
    ]);
  });

  it("staff never decide, even for a class without a teacher; a learner who left the class cannot resend", async () => {
    await ownerQuery("update class set teacher_id = null where name = 'A2 Morning — Mon/Wed'");
    const staff = await decide(await as(SAM), 1, "approve");
    expect([staff.statusCode, staff.json().reason]).toEqual([403, "not_allowed"]);
    await ownerQuery(
      "update class set teacher_id = (select id from teacher where name = 'Tara') where name = 'A2 Morning — Mon/Wed'",
    );
    expect((await decide(await as(TARA), 1, "return", "Try turn 3 again.")).json().ok).toBe(true);
    await ownerQuery(`delete from roster where learner_id = '${L(1)}'`);
    const gone = await retry(await as(LINH), [0, 1, 2, 0]);
    expect([gone.statusCode, gone.json().reason]).toEqual([404, "not_found"]);
  });

  it("a paused speaking_returned rule shows no evidence and fires nothing", async () => {
    const sam = await as(SAM);
    const tara = await as(TARA);
    await decide(tara, 1, "return", "Try turn 3 again.");
    const rule = ((await (await sam("GET", "/v1/engine/rules")).json()) as Rule[]).find(
      (r) => r.kind === "speaking_returned",
    )!;
    expect((await sam("POST", `/v1/engine/rules/${rule.id}`, { enabled: false })).json().ok).toBe(
      true,
    );
    expect((await card(sam, "Linh N.")).care.evidence.map((e) => e.kind)).not.toContain(
      "speaking_returned",
    );
    expect((await run(sam)).statusCode).toBe(200);
    expect(await spokenEvents()).toEqual([]);
  });

  it("a decided review cannot change: column grants for the application, a trigger for the owner", async () => {
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    try {
      for (const q of [
        "update course_speaking_attempt set score = 100",
        "update course_speaking_attempt set choices = '[0,1,2,0]'",
        "delete from course_speaking_attempt",
      ])
        await expect(app.query(q)).rejects.toThrow(/permission denied/);
    } finally {
      await app.end();
    }
    await decide(await as(TARA), 1, "approve");
    await expect(
      ownerQuery("update course_speaking_attempt set status = 'returned', note = 'Again.'"),
    ).rejects.toThrow(/decided once/);
    await expect(ownerQuery("update course_speaking_attempt set score = 0")).rejects.toThrow(
      /decided once/,
    );
    // Only one rehearsal waits per block.
    await expect(
      ownerQuery(
        `insert into course_speaking_attempt (org_id, learner_id, course_ref, lesson_id, block_id, attempt, choices, score, submitted_at)
         values ('${NOVA}', '${L(1)}', '${REF}', 'a2-l3', '${BLOCK}', 2, '[0,0,0,0]', 50, now()),
                ('${NOVA}', '${L(1)}', '${REF}', 'a2-l3', '${BLOCK}', 3, '[0,0,0,0]', 50, now())`,
      ),
    ).rejects.toThrow(/one_pending/);
  });
});
