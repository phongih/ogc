// Mission Box (owner 24/11, Course Studio blocks part B): completing a lesson confirms its missions
// (optional note, attempt 1 pending); the CLASS TEACHER approves or returns with a note; a returned
// mission may be sent again; staff see the queue only. An approval earns XP ("Mission approved")
// and the Explorer badge — never skill evidence.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  blockIssue,
  BLOCK_KINDS,
  type AuthoredCourseDetail,
  type CourseContent,
  type CourseLesson,
  type LearnerGamification,
  type LearnerProfile,
  type MissionReviewQueue,
  type MyLessonView,
} from "@ogc/contracts";
import { buildIiosMock } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { L, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "mission-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-24T05:00:00Z");
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const BEN = "iios-principal-teacher-2";
const MINH = "iios-principal-learner-2";
const REF = "CS-A2-EVERYDAY";
const LESSON: CourseLesson = {
  id: "a2-l4",
  title: "Plants around us",
  blocks: [
    {
      id: "a2-l4-m1",
      kind: "mission_box",
      title: "Seed & Stem Explorer",
      task: "Find 1 leaf and 1 seed around your house. Observe how they look and feel.",
      whyItMatters: "Plants use seeds to grow new life.",
    },
  ],
};
let seq = 0;
const key = () => `mis-${Date.now()}-${++seq}-abc`;

describe("the mission_box block (no database)", () => {
  it("15 kinds; title and task required on submit; unknown fields refused", () => {
    expect(BLOCK_KINDS).toHaveLength(15);
    const m = LESSON.blocks[0]!;
    expect(blockIssue(m, "submit")).toBeNull();
    expect(blockIssue({ ...m, task: "" }, "submit")).toMatch(/task is empty/);
    expect(blockIssue({ ...m, task: "" }, "draft")).toBeNull();
    expect(blockIssue({ ...m, xp: 50 }, "draft")).toMatch(/unknown field/);
    expect(blockIssue({ ...m, whyItMatters: "x".repeat(201) }, "draft")).toMatch(/too long/);
  });
});

describe.skipIf(!hasPg)("Mission Box — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;
  let now = NOW;

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
    now = NOW;
    await api?.close();
    await t?.drop();
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
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
  type Call = Awaited<ReturnType<typeof as>>;
  const reason = (r: { json: () => unknown }) => (r.json() as { reason: string }).reason;
  const detailOf = (r: { json: () => unknown }) => (r.json() as { detail?: string }).detail ?? "";

  async function publish() {
    const tara = await as(TARA);
    const d = (await tara("GET", `/v1/courses/${REF}`)).json() as AuthoredCourseDetail;
    const content: CourseContent = { ...d.draft, lessons: [...d.draft.lessons, LESSON] };
    expect(
      (
        await tara("POST", `/v1/courses/${REF}/draft`, { content, baseRevision: d.draftRevision })
      ).json(),
    ).toMatchObject({ ok: true });
    expect((await tara("POST", `/v1/courses/${REF}/submit`, {})).json()).toMatchObject({
      ok: true,
    });
    expect((await (await as(SAM))("POST", `/v1/courses/${REF}/approve`, {})).json()).toMatchObject({
      ok: true,
    });
  }
  const view = async (c: Call) =>
    (await c("GET", `/v1/me/class-courses/${REF}/a2-l4`)).json() as MyLessonView;
  const rewards = async (c: Call) =>
    ((await c("GET", "/v1/me/rewards")).json() as LearnerGamification[])[0]!;
  const decide = (c: Call, attempt: number, decision: string, note?: string) =>
    c("POST", "/v1/mission-reviews/decide", {
      learnerId: L(2),
      ref: REF,
      lessonId: "a2-l4",
      blockId: "a2-l4-m1",
      attempt,
      decision,
      ...(note !== undefined ? { note } : {}),
    });

  it("completing confirms the mission; the class teacher returns, the learner sends again, it is approved → XP only", async () => {
    await publish();
    const minh = await as(MINH);
    const complete = (missions?: unknown) =>
      minh("POST", `/v1/me/class-courses/${REF}/a2-l4/complete`, {
        answers: {},
        reflections: {},
        ...(missions !== undefined ? { missions } : {}),
      });
    for (const [m, detail] of [
      [undefined, /confirm every mission/],
      [{}, /confirm every mission/],
      [{ "a2-l4-m1": "x".repeat(301) }, /at most 300/],
      [{ "a2-l4-m1": 5 }, /at most 300/],
      [{ "a2-l4-m1": "", other: "" }, /not in this lesson/],
    ] as const) {
      const r = await complete(m);
      expect(r.statusCode, JSON.stringify(m)).toBe(422);
      expect(detailOf(r)).toMatch(detail);
    }
    expect(
      (await complete({ "a2-l4-m1": "  Found a round seed and a green leaf.  " })).json(),
    ).toEqual({
      ok: true,
      score: null,
      practiceScore: null,
    });
    expect((await view(minh)).missions).toEqual([
      expect.objectContaining({
        blockId: "a2-l4-m1",
        attempt: 1,
        note: "Found a round seed and a green leaf.",
        status: "pending",
        reviewNote: null,
      }),
    ]);
    // waiting: no mission XP yet (the lesson itself counts as an activity)
    let g = await rewards(minh);
    expect(g.recent.map((e) => e.kind)).toEqual(["activity_completed"]);

    now = NOW + 3_600_000; // reviewed an hour later
    // the queue: the class teacher may review; staff see it only
    const tara = await as(TARA);
    const sam = await as(SAM);
    const q = (await tara("GET", "/v1/mission-reviews")).json() as MissionReviewQueue;
    expect(q.mayReview).toBe(true);
    expect(q.items).toEqual([
      expect.objectContaining({
        learnerName: "Minh T.",
        className: "A2 Morning — Mon/Wed",
        lessonTitle: "Plants around us",
        title: "Seed & Stem Explorer",
        note: "Found a round seed and a green leaf.",
        attempt: 1,
      }),
    ]);
    expect(((await sam("GET", "/v1/mission-reviews")).json() as MissionReviewQueue).mayReview).toBe(
      false,
    );
    expect((await minh("GET", "/v1/mission-reviews")).statusCode).toBe(403);
    expect(reason(await decide(sam, 1, "approve"))).toBe("not_allowed");
    expect(reason(await decide(await as(BEN), 1, "approve"))).toBe("not_allowed"); // not his class

    // returned: a note is required
    expect(detailOf(await decide(tara, 1, "return"))).toMatch(/needs a note/);
    expect(reason(await decide(tara, 1, "maybe"))).toBe("invalid");
    expect(
      (await decide(tara, 1, "return", "Tell me the colour of the seed too.")).statusCode,
    ).toBe(200);
    expect(reason(await decide(tara, 1, "approve"))).toBe("invalid_step"); // decided once
    expect((await view(minh)).missions![0]).toMatchObject({
      status: "returned",
      reviewNote: "Tell me the colour of the seed too.",
      reviewerName: "Tara",
    });
    expect((await tara("GET", "/v1/mission-reviews")).json()).toMatchObject({ items: [] });

    // sent again (attempt 2); only a returned mission can be
    const again = (note: unknown) =>
      minh("POST", `/v1/me/class-courses/${REF}/a2-l4/mission/a2-l4-m1`, { note });
    expect(reason(await again("x".repeat(301)))).toBe("invalid");
    expect((await again("The seed is brown, the leaf is green.")).statusCode).toBe(200);
    expect(reason(await again("Again"))).toBe("invalid_step");
    expect(
      reason(await minh("POST", `/v1/me/class-courses/${REF}/a2-l4/mission/nope`, { note: "" })),
    ).toBe("not_found");
    expect(reason(await decide(tara, 1, "approve"))).toBe("invalid_step"); // an old attempt
    expect((await decide(tara, 2, "approve", "Well observed!")).statusCode).toBe(200);
    expect((await view(minh)).missions![0]).toMatchObject({ attempt: 2, status: "approved" });

    // XP only: +20 "Mission approved" and the Explorer badge; the skill profile does not move
    g = await rewards(minh);
    expect(g.recent[0]).toMatchObject({
      kind: "mission_approved",
      xp: 20,
      evidence: "Mission: Seed & Stem Explorer · approved by your teacher",
    });
    expect(g.xp).toBe(30);
    expect(g.badges.find((b) => b.kind === "explorer")).toMatchObject({
      earned: true,
      title: "Explorer",
    });
    const skills = (await minh("GET", "/v1/me/skills")).json() as LearnerProfile;
    for (const s of Object.values(skills.skills)) expect(s.evidenceCount).toBe(0);
    expect(JSON.stringify((await sam("GET", "/v1/students")).json())).not.toMatch(/mission/i);

    // staff tune it within the closed catalog
    expect(
      (
        await sam("POST", "/v1/rewards/settings", {
          rules: [{ kind: "mission_approved", xp: 40 }],
          badges: [{ kind: "explorer", enabled: false }],
        })
      ).statusCode,
    ).toBe(200);
    g = await rewards(minh);
    expect(g.xp).toBe(50);
    expect(g.badges.find((b) => b.kind === "explorer")).toBeUndefined();
  });

  it("a lesson without missions needs none; the database decides a review once", async () => {
    await publish();
    const minh = await as(MINH);
    expect(
      (
        await minh("POST", `/v1/me/class-courses/${REF}/a2-l1/complete`, {
          answers: { "a2-l1-b4": 1 },
          reflections: {},
          missions: { "a2-l4-m1": "" }, // not in this lesson
        })
      ).statusCode,
    ).toBe(422);
    await minh("POST", `/v1/me/class-courses/${REF}/a2-l4/complete`, {
      answers: {},
      reflections: {},
      missions: { "a2-l4-m1": "" },
    });
    expect((await view(minh)).missions![0]!.note).toBe("");
    // a class with no teacher yet: staff still may not review (no null === null match)
    const owner = new pg.Client({ connectionString: t.ownerUrl });
    await owner.connect();
    await owner.query("select set_config('app.org_id', $1, false)", [NOVA]);
    const upd = await owner.query(
      "update class set teacher_id = null where name = 'A2 Morning — Mon/Wed'",
    );
    expect(upd.rowCount).toBe(1);
    await owner.end();
    expect(reason(await decide(await as(SAM), 1, "approve"))).toBe("not_allowed");
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    const inOrg = async (q: string) => {
      await app.query("begin");
      try {
        await app.query("select set_config('app.org_id', $1, true)", [NOVA]);
        return await app.query(q);
      } finally {
        await app.query("rollback");
      }
    };
    try {
      await expect(inOrg("update course_mission_attempt set note = 'changed'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(inOrg("delete from course_mission_attempt")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        inOrg(
          "update course_mission_attempt set status = 'approved', reviewed_at = now(), reviewed_by = 'x'; update course_mission_attempt set status = 'returned', review_note = 'again'",
        ),
      ).rejects.toThrow(/decided once/);
      await expect(
        inOrg(
          "update course_mission_attempt set status = 'returned', reviewed_at = now(), reviewed_by = 'x'",
        ),
      ).rejects.toThrow(/check constraint/); // a returned mission names why
      await expect(
        inOrg(
          `insert into course_mission_attempt (org_id, learner_id, course_ref, lesson_id, block_id, attempt, submitted_at)
           select org_id, learner_id, course_ref, lesson_id, block_id, 2, now() from course_mission_attempt`,
        ),
      ).rejects.toThrow(/duplicate key/); // one waiting per block
      expect(
        (
          await inOrg(
            "insert into reward_rule (org_id, kind, enabled, xp) values (ogc_current_org(), 'mission_approved', true, 30) returning kind",
          )
        ).rows,
      ).toEqual([{ kind: "mission_approved" }]);
      await expect(
        inOrg(
          "insert into badge_rule (org_id, kind, enabled) values (ogc_current_org(), 'secret', true)",
        ),
      ).rejects.toThrow(/check constraint/);
    } finally {
      await app.end();
    }
  });
});
