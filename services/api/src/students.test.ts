import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LearnerProfile, StudentCard } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { L, LUMEN, NOVA, seedDev, sid } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "studnt-test-secret-0123456789abcd";
const NOW = Date.parse("2026-11-23T05:00:00Z");
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const BEN = "iios-principal-teacher-2";
const LINH = "iios-principal-learner-1";
const OLIVIA = "iios-principal-admin-1";
const MINH = "iios-principal-learner-2";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `stu-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("skill profile + Current Students — API", () => {
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
    return (method: "GET" | "POST" | "PUT", url: string, body?: unknown, idem = key()) =>
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
  const cards = async (c: Call) => (await c("GET", "/v1/students")).json() as StudentCard[];
  const card = async (c: Call, name: string) => (await cards(c)).find((x) => x.name === name)!;
  const skills = async (c: Call) => (await c("GET", "/v1/me/skills")).json() as LearnerProfile;
  const DAY = 86_400_000;
  const complete = (c: Call, lesson: string, answers: object, reflections: object = {}) =>
    c("POST", `/v1/me/class-courses/CS-A2-EVERYDAY/${lesson}/complete`, { answers, reflections });

  it("staff see every learner of their students:view centers, with level and evidence; tuition is information only", async () => {
    const all = await cards(await as(SAM));
    expect(all.map((c) => [c.name, c.care.level])).toEqual([
      ["An P.", "watch"],
      ["Linh N.", "watch"],
      ["Minh T.", "watch"],
      ["Huy D.", "ok"],
      ["Khoa L.", "ok"],
      ["Thao V.", "ok"],
      ["Vy H.", "ok"],
    ]);
    const an = all[0];
    expect(an.care.evidence).toEqual([
      { level: "watch", kind: "skill_low", text: "Reading is 58, below 60 (placement test only)" },
    ]);
    expect(an.attendance).toMatchObject({ present: 1, absent: 1, marked: 2, pct: 50 });
    expect(an.studio).toMatchObject({ completedLessons: 1, totalLessons: 2 });
    expect(an.progressPct).toBe(50);
    expect(an.makeups).toEqual({ open: 1, overdue: 0 });
    expect(an.recommendations.map((r) => r.link)).toEqual([null, "/makeups"]);
    // Overdue tuition never changes the level.
    const vy = all.find((c) => c.name === "Vy H.")!;
    expect([vy.care.level, vy.tuition]).toEqual([
      "ok",
      { balanceVnd: 6_900_000, overdueVnd: 6_900_000 },
    ]);
    // No psychological labels anywhere: every evidence line names its data source.
    for (const c of all)
      for (const e of c.care.evidence)
        expect(e.text).toMatch(/placement|quiz|attendance|marked|made up/);
    // The front-desk policy: District 1 classes only (A2 Morning, A2 Evening).
    state.attachments.set(SAM, "policy-front-desk-d1");
    expect((await cards(await as(SAM))).map((c) => c.name)).toEqual([
      "An P.",
      "Linh N.",
      "Minh T.",
      "Khoa L.",
      "Vy H.",
    ]);
  });

  it("a class teacher sees their own classes' learners, without tuition; learners and guardians see nothing", async () => {
    const tara = await cards(await as(TARA));
    expect(tara.map((c) => c.name)).toEqual(["An P.", "Linh N.", "Minh T.", "Huy D.", "Thao V."]);
    expect(tara.every((c) => c.tuition === null)).toBe(true);
    expect(tara.flatMap((c) => c.recommendations).every((r) => r.link === null)).toBe(true);
    expect((await cards(await as(BEN))).map((c) => c.name)).toEqual(["Khoa L.", "Vy H."]);
    expect((await (await as(LINH))("GET", "/v1/students")).statusCode).toBe(403);
    expect((await (await as("iios-principal-guardian-1"))("GET", "/v1/students")).statusCode).toBe(
      403,
    );
    expect((await cards(await as(LUMEN_STAFF, LUMEN))).map((c) => c.name)).toEqual([
      "Learner (Lumen)",
    ]);
  });

  it("class-course quiz scores are Use of English evidence: a good score lifts the level, a bad one is a drop", async () => {
    const minh = await as(MINH);
    expect((await skills(minh)).skills.use_of_english).toEqual({
      level: 52,
      evidenceCount: 0,
      lastUpdatedAt: null,
    });
    expect((await complete(minh, "a2-l1", { "a2-l1-b4": 1 })).json()).toEqual({
      ok: true,
      score: 100,
      practiceScore: null,
    });
    const up = (await skills(minh)).skills.use_of_english;
    expect([up.level, up.evidenceCount]).toEqual([71, 1]); // 0.4 × 100 + 0.6 × 52
    expect((await card(await as(SAM), "Minh T.")).care).toEqual({ level: "ok", evidence: [] });
    now += 60_000;
    expect(
      (await complete(minh, "a2-l2", { "a2-l2-b3": 1 }, { "a2-l2-b4": "By bus." })).json(),
    ).toEqual({ ok: true, score: 0, practiceScore: null });
    const down = (await skills(minh)).skills.use_of_english;
    expect([down.level, down.evidenceCount]).toEqual([43, 2]); // 0.6 × 71
    const c = await card(await as(TARA), "Minh T.");
    expect(c.care.level).toBe("support");
    expect(c.care.evidence.map((e) => e.text)).toEqual([
      "Use of English dropped 28 to 43 after the latest class-course quiz",
      "Use of English is 43, below 60 (from class-course quizzes)",
    ]);
    expect(c.studio).toMatchObject({ completedLessons: 2, totalLessons: 3 });
  });

  it("attendance: two absences in a row need support; below 80% of at least 3 marked sessions is watched", async () => {
    const tara = await as(TARA);
    // An was absent at k1-m2; marking her absent at k1-m1 makes two in a row.
    const r = await tara("PUT", `/v1/sessions/${sid("k1", -1)}/attendance`, {
      marks: [
        { learnerId: L(1), mark: "present" },
        { learnerId: L(2), mark: "present" },
        { learnerId: L(3), mark: "absent" },
      ],
    });
    expect(r.statusCode).toBe(200);
    const an = await card(await as(SAM), "An P.");
    expect(an.care.level).toBe("support");
    expect(an.care.evidence.map((e) => [e.level, e.text])).toEqual([
      ["support", "Absent from the last 2 marked sessions (attendance)"],
      ["watch", "Reading is 58, below 60 (placement test only)"],
      ["watch", "Attended 1 of 3 marked sessions (33.3%, below 80%)"],
    ]);
    expect(an.attendance.recent).toEqual(["present", "absent", "absent"]);
    expect(an.makeups.open).toBe(2);
  });

  it("make-ups: the deadline close is watched, past it needs support", async () => {
    const huyItem = async () => await card(await as(SAM), "Huy D.");
    expect((await huyItem()).care.level).toBe("ok");
    const board = (await (await as(SAM))("GET", "/v1/makeups")).json() as {
      items: { learnerName: string; dueAt: string }[];
    };
    const due = Date.parse(board.items.find((i) => i.learnerName === "Huy D.")!.dueAt);
    now = due - 2 * DAY;
    const soon = await huyItem();
    expect(soon.care.level).toBe("watch");
    expect(soon.care.evidence.map((e) => e.kind)).toEqual(["makeup_due"]);
    expect(soon.care.evidence[0].text).toMatch(/not made up; 2 days left$/);
    now = due + DAY;
    const late = await huyItem();
    expect(late.care.level).toBe("support");
    expect(late.care.evidence[0]).toMatchObject({ kind: "makeup_overdue" });
    expect(late.care.evidence[0].text).toMatch(/not made up; deadline .* has passed$/);
    expect(late.makeups).toEqual({ open: 1, overdue: 1 });
  });

  it("skills: a learner reads their own profile only", async () => {
    expect(await skills(await as(LINH))).toMatchObject({
      learnerId: L(1),
      cefrBand: "A2",
      skills: {
        reading: { level: 70, evidenceCount: 0 },
        use_of_english: { level: 79, evidenceCount: 1 }, // "Making plans" quiz, 100 (seed)
        speaking: { level: 55, evidenceCount: 0 }, // the rehearsal waits for Tara: not counted
      },
    });
    expect((await (await as(TARA))("GET", "/v1/me/skills")).statusCode).toBe(403);
    expect((await (await as("iios-principal-guardian-1"))("GET", "/v1/me/skills")).statusCode).toBe(
      403,
    );
    // The Lumen learner has no OGC learner record linked to their principal: nothing to show.
    const lumen = await as("iios-principal-learner-org2", LUMEN);
    expect((await lumen("GET", "/v1/me/skills")).statusCode).toBe(404);
  });
  it("an absence streak ends at a present mark; the teacher's suggestions carry no staff links", async () => {
    const tara = await as(TARA);
    const mark = (n: number, an: "present" | "absent") =>
      tara("PUT", `/v1/sessions/${sid("k1", n)}/attendance`, {
        marks: [
          { learnerId: L(1), mark: "present" },
          { learnerId: L(2), mark: "present" },
          { learnerId: L(3), mark: an },
        ],
      });
    // An: absent, present, absent → one absence in a row, not two.
    expect((await mark(-3, "absent")).statusCode).toBe(200);
    expect((await mark(-2, "present")).statusCode).toBe(200);
    expect((await mark(-1, "absent")).statusCode).toBe(200);
    const an = await card(await as(SAM), "An P.");
    expect(an.care.evidence.map((e) => e.kind)).not.toContain("absence_streak");
    expect(an.attendance.recent).toEqual(["absent", "present", "absent"]);
    // Two in a row: the teacher sees the evidence, without a link to the staff-only make-up board.
    expect((await mark(-2, "absent")).statusCode).toBe(200);
    const t = await card(tara, "An P.");
    expect(t.care.evidence[0].kind).toBe("absence_streak");
    expect(t.recommendations.every((r) => r.link === null)).toBe(true);
    expect(
      (await card(await as(SAM), "An P.")).recommendations.find((r) => r.kind === "absence_streak"),
    ).toMatchObject({ link: "/makeups" });
  });

  it("a make-up done no longer counts", async () => {
    const tara = await as(TARA);
    await tara("PUT", `/v1/sessions/${sid("k1", -1)}/attendance`, {
      marks: [
        { learnerId: L(1), mark: "absent" },
        { learnerId: L(2), mark: "present" },
        { learnerId: L(3), mark: "present" },
      ],
    });
    const item = encodeURIComponent(`${sid("k1", -1)}::${L(1)}`);
    expect((await card(await as(SAM), "Linh N.")).makeups).toEqual({ open: 1, overdue: 0 });
    expect((await (await as(SAM))("POST", `/v1/makeups/${item}/self-study`)).statusCode).toBe(200);
    const sub = await (
      await as(LINH)
    )("POST", `/v1/me/makeups/${item}/self-study`, {
      note: "Did Unit 6 exercises 1–4",
    });
    expect(sub.statusCode).toBe(200);
    expect((await tara("POST", `/v1/makeups/${item}/confirm`)).statusCode).toBe(200);
    const linh = await card(await as(SAM), "Linh N.");
    expect(linh.makeups).toEqual({ open: 0, overdue: 0 });
    expect(linh.recommendations.map((r) => r.kind)).not.toContain("makeup_due");
  });

  it("tuition shows only for staff whose policy includes billing", async () => {
    const o = await as(OLIVIA);
    const made = await o("POST", "/v1/access/policies", {
      name: "Care only",
      rules: [{ action: "students:view" }],
    });
    expect(made.statusCode).toBe(200);
    const ref = (made.json().view.policies as { id: string; name: string }[]).find(
      (x) => x.name === "Care only",
    )!.id;
    state.attachments.set(SAM, ref);
    const all = await cards(await as(SAM));
    expect(all).toHaveLength(7);
    expect(all.every((c) => c.tuition === null)).toBe(true);
  });
});
