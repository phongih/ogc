// P2 · session attendance — mock adapter: authz, started-only, complete-roster, overwrite,
// summary from marked sessions only, and the attendance-v1 support signal.
import { as } from "../../test/grants";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetAttendanceForTests, absenceStreakFor, mockAttendance } from "./mockAttendance";
import { mockSupport } from "./mockProfile";
import { classes } from "../../fixtures/teaching";
import { seedSessions } from "../../fixtures/attendance";
import { LEARNER_LINH, LEARNER_MINH } from "../../fixtures/personas";
import { LEARNER_AN, LEARNER_HUY } from "../../fixtures/learners";

const T = "demo-teacher";
const A2 = classes[0].id;
const B1 = classes[1].id;
const a2ToMark = () =>
  seedSessions.filter(
    (s) => s.classId === A2 && !s.seededMarks && Date.parse(s.at) <= Date.now(),
  )[0];

beforeEach(() => __resetAttendanceForTests());

describe("mockAttendance — sessions", () => {
  it("lists A2 newest first: 1 upcoming, 1 to mark, 3 marked; all in the class's own slot", async () => {
    const list = (await mockAttendance.listClassSessions(as(T), A2))!;
    expect(list.map((s) => s.status)).toEqual([
      "upcoming",
      "to_mark",
      "marked",
      "marked",
      "marked",
    ]);
    expect(list[0]).toMatchObject({ id: "SES-001", title: "A2 — Unit 7" });
    for (const s of list) expect([2]).toContain(new Date(s.at).getUTCHours()); // 09:00 ICT
    const times = list.map((s) => Date.parse(s.at));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("is fail-closed for anyone but the owning teacher", async () => {
    for (const other of ["demo-learner", "demo-guardian", "demo-staff", "demo-staff-org2"]) {
      expect(await mockAttendance.listClassSessions(as(other), A2)).toBeNull();
      expect(await mockAttendance.getSessionAttendance(as(other), a2ToMark().id)).toBeNull();
      expect(await mockAttendance.getClassSummary(as(other), A2)).toBeNull();
      expect(await mockAttendance.listToMark(as(other))).toEqual([]);
      expect(
        await mockAttendance.recordAttendance(as(other), a2ToMark().id, {
          marks: [{ learnerId: LEARNER_LINH, mark: "present" }],
        }),
      ).toEqual({ ok: false, reason: "not_found" });
    }
  });

  it("lists the one started-but-unmarked session to take", async () => {
    const todo = await mockAttendance.listToMark(as(T));
    expect(todo.map((s) => s.id)).toEqual([a2ToMark().id]);
  });
});

describe("mockAttendance — recording", () => {
  const all = (mark: "present" | "late" | "absent") =>
    [LEARNER_LINH, LEARNER_MINH, LEARNER_AN].map((learnerId) => ({ learnerId, mark }));

  it("refuses a session that has not started", async () => {
    expect(
      await mockAttendance.recordAttendance(as(T), "SES-001", { marks: all("present") }),
    ).toEqual({
      ok: false,
      reason: "not_started",
    });
  });

  it("requires every learner on the roster, and only them", async () => {
    const id = a2ToMark().id;
    expect(
      await mockAttendance.recordAttendance(as(T), id, { marks: all("present").slice(0, 2) }),
    ).toEqual({
      ok: false,
      reason: "incomplete",
    });
    expect(
      await mockAttendance.recordAttendance(as(T), id, {
        marks: [...all("present"), { learnerId: LEARNER_HUY, mark: "present" }],
      }),
    ).toEqual({ ok: false, reason: "not_on_roster" });
    expect((await mockAttendance.getSessionAttendance(as(T), id))!.session.status).toBe("to_mark");
  });

  it("saves, then a later save replaces the earlier marks", async () => {
    const id = a2ToMark().id;
    const first = await mockAttendance.recordAttendance(as(T), id, { marks: all("present") });
    expect(first.ok && first.attendance.session.status).toBe("marked");
    await mockAttendance.recordAttendance(as(T), id, { marks: all("late") });
    const view = (await mockAttendance.getSessionAttendance(as(T), id))!;
    expect(view.rows.map((r) => r.mark)).toEqual(["late", "late", "late"]);
    expect(await mockAttendance.listToMark(as(T))).toEqual([]);
  });
});

describe("mockAttendance — summary and support signal", () => {
  it("counts marked sessions only; attended = present + late", async () => {
    const rows = (await mockAttendance.getClassSummary(as(T), A2))!;
    const by = (id: string) => rows.find((r) => r.learnerId === id)!;
    expect(by(LEARNER_MINH)).toMatchObject({
      present: 2,
      late: 1,
      absent: 0,
      marked: 3,
      attendedPct: 100,
      absentStreak: 0,
    });
    expect(by(LEARNER_AN)).toMatchObject({
      present: 2,
      late: 0,
      absent: 1,
      marked: 3,
      attendedPct: 67,
      absentStreak: 1,
    });
    const b1 = (await mockAttendance.getClassSummary(as(T), B1))!;
    expect(b1.find((r) => r.learnerId === LEARNER_HUY)).toMatchObject({
      absent: 2,
      attendedPct: 0,
      absentStreak: 2,
    });
  });

  it("a second absence in a row flags An by attendance; a later correction clears it", async () => {
    expect(absenceStreakFor(LEARNER_AN, [A2])).toBeNull();
    const id = a2ToMark().id;
    const marks = [
      { learnerId: LEARNER_LINH, mark: "present" as const },
      { learnerId: LEARNER_MINH, mark: "present" as const },
      { learnerId: LEARNER_AN, mark: "absent" as const },
    ];
    await mockAttendance.recordAttendance(as(T), id, { marks });
    expect(absenceStreakFor(LEARNER_AN, [A2])).toBe(2);
    let an = (await mockSupport.listNeedsSupport(T)).find((i) => i.learnerName === "An P.")!;
    expect(an.signals).toContainEqual({ kind: "absences", source: "attendance", sessions: 2 });
    expect(an.evidenceBacked).toBe(true);
    // Correction: An was actually late — the signal goes away (latest save wins).
    await mockAttendance.recordAttendance(as(T), id, {
      marks: marks.map((m) => ({ ...m, mark: m.learnerId === LEARNER_AN ? "late" : m.mark })),
    });
    an = (await mockSupport.listNeedsSupport(T)).find((i) => i.learnerName === "An P.")!;
    expect(an.signals.some((s) => s.kind === "absences")).toBe(false);
    expect(an.evidenceBacked).toBe(false);
  });
});
