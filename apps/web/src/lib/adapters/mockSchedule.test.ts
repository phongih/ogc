// P2 · center operations — schedule + teacher assignment (staff only), and how the live schedule
// flows into the teacher dashboard, attendance and the support queue.
import { as } from "../../test/grants";
import { beforeEach, describe, expect, it } from "vitest";
import { mockSchedule } from "./mockSchedule";
import { __resetAttendanceForTests, mockAttendance } from "./mockAttendance";
import { mockTeacher } from "./mockTeacher";
import { mockSupport } from "./mockProfile";
import { classes } from "../../fixtures/teaching";
import { TEACHER_BEN, TEACHER_TARA } from "../../fixtures/personas";
import { seedSessions } from "../../fixtures/attendance";

const S = "demo-staff";
const A2 = classes[0].id;
const DAY = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();
const a2ToMark = () =>
  seedSessions.filter(
    (s) => s.classId === A2 && !s.seededMarks && Date.parse(s.at) <= Date.now(),
  )[0].id;
const a2Marked = () => seedSessions.filter((s) => s.classId === A2 && s.seededMarks)[0].id;

beforeEach(() => __resetAttendanceForTests());

describe("mockSchedule — access", () => {
  it("staff of the tenant see every class and both teachers; nobody else does", async () => {
    const o = (await mockSchedule.getOverview(as(S)))!;
    expect(o.classes.map((c) => c.className)).toEqual([
      "A2 Morning — Mon/Wed",
      "B1 Evening — Tue/Thu",
      "A2 Evening — Tue/Thu",
    ]);
    expect(o.classes[2].teacher?.name).toBe("Ben");
    expect(o.teachers.map((t) => t.name)).toEqual(["Tara", "Ben"]);
    expect(o.classes[0].teacher?.name).toBe("Tara");
    for (const other of ["demo-teacher", "demo-teacher-2", "demo-learner", "demo-guardian"])
      expect(await mockSchedule.getOverview(as(other))).toBeNull();
    expect((await mockSchedule.getOverview(as("demo-staff-org2")))!.classes).toEqual([]);
    expect(await mockSchedule.reschedule(as("demo-teacher"), "SES-001", inDays(3))).toEqual({
      ok: false,
      reason: "not_staff",
    });
    expect(await mockSchedule.reschedule(as("demo-staff-org2"), "SES-001", inDays(3))).toEqual({
      ok: false,
      reason: "not_found",
    });
  });
});

describe("mockSchedule — moving and cancelling", () => {
  it("reschedules an upcoming session; the teacher dashboard follows", async () => {
    const at = inDays(4);
    const r = await mockSchedule.reschedule(as(S), "SES-001", at);
    expect(r.ok).toBe(true);
    const d = (await mockTeacher.getDashboard(as("demo-teacher")))!;
    expect(d.upcoming.find((s) => s.id === "SES-001")!.at).toBe(at);
    expect(d.classes.find((c) => c.id === A2)!.nextSessionAt).toBe(at);
  });

  it("history is not moved or cancelled; times must be in the future", async () => {
    expect(await mockSchedule.reschedule(as(S), a2ToMark(), inDays(3))).toEqual({
      ok: false,
      reason: "already_started",
    });
    expect(await mockSchedule.cancelWithReplacement(as(S), a2Marked(), inDays(3))).toEqual({
      ok: false,
      reason: "already_started",
    });
    expect(await mockSchedule.reschedule(as(S), "SES-001", inDays(-1))).toEqual({
      ok: false,
      reason: "in_past",
    });
    expect(await mockSchedule.cancelWithReplacement(as(S), "SES-001", "")).toEqual({
      ok: false,
      reason: "in_past",
    });
  });

  it("cancelling REQUIRES a replacement: the whole class keeps the lesson", async () => {
    const at = inDays(5);
    const r = await mockSchedule.cancelWithReplacement(as(S), "SES-001", at);
    expect(r.ok).toBe(true);
    const sessions = r.ok ? r.classSchedule.sessions : [];
    const old = sessions.find((s) => s.id === "SES-001")!;
    const repl = sessions.find((s) => s.replaces === "SES-001")!;
    expect(old).toMatchObject({ state: "cancelled", replacedBy: repl.id });
    expect(repl).toMatchObject({ title: "A2 — Unit 7", at, state: "scheduled" });
    // Attendance: the cancelled one cannot be marked; the replacement is upcoming.
    const list = (await mockAttendance.listClassSessions(as("demo-teacher"), A2))!;
    expect(list.find((s) => s.id === "SES-001")!.status).toBe("cancelled");
    expect(list.find((s) => s.id === repl.id)!.status).toBe("upcoming");
    expect(
      await mockAttendance.recordAttendance(as("demo-teacher"), "SES-001", {
        marks: [{ learnerId: classes[0].id, mark: "present" }],
      }),
    ).toEqual({ ok: false, reason: "cancelled" });
    expect(await mockSchedule.cancelWithReplacement(as(S), "SES-001", inDays(6))).toEqual({
      ok: false,
      reason: "cancelled",
    });
  });

  it("adds an extra session to a class", async () => {
    const r = await mockSchedule.addSession(as(S), A2, "Review before test", inDays(2));
    expect(r.ok && r.classSchedule.sessions.some((s) => s.title === "Review before test")).toBe(
      true,
    );
    expect(await mockSchedule.addSession(as(S), A2, "x", inDays(-2))).toEqual({
      ok: false,
      reason: "in_past",
    });
  });
});

describe("mockSchedule — teachers", () => {
  it("reassigning a class moves the dashboard, roster scope and support queue to the new teacher", async () => {
    expect((await mockSupport.listNeedsSupport(as("demo-teacher-2"))).length).toBe(0);
    expect((await mockSchedule.assignTeacher(as(S), A2, TEACHER_BEN)).ok).toBe(true);
    const ben = (await mockTeacher.getDashboard(as("demo-teacher-2")))!;
    expect(ben.teacherName).toBe("Ben");
    expect(ben.classes.map((c) => c.id)).toEqual([A2, classes[2].id]);
    const tara = (await mockTeacher.getDashboard(as("demo-teacher")))!;
    expect(tara.classes.map((c) => c.id)).toEqual([classes[1].id]);
    expect(
      (await mockSupport.listNeedsSupport(as("demo-teacher-2"))).map((i) => i.learnerName).sort(),
    ).toEqual(["An P.", "Linh N.", "Minh T."]);
    expect(await mockAttendance.listClassSessions(as("demo-teacher"), A2)).toBeNull();
    expect(await mockSchedule.assignTeacher(as(S), A2, "nobody")).toEqual({
      ok: false,
      reason: "unknown_teacher",
    });
  });

  it("a substitute marks that one session; the class teacher sees who covers it", async () => {
    const id = a2ToMark();
    expect(await mockSchedule.setSubstitute(as(S), id, TEACHER_TARA)).toEqual({
      ok: false,
      reason: "same_teacher",
    });
    expect((await mockSchedule.setSubstitute(as(S), id, TEACHER_BEN)).ok).toBe(true);
    expect((await mockAttendance.listToMark(as("demo-teacher-2"))).map((s) => s.id)).toEqual([id]);
    const view = (await mockAttendance.getSessionAttendance(as("demo-teacher-2"), id))!;
    const r = await mockAttendance.recordAttendance(as("demo-teacher-2"), id, {
      marks: view.rows.map((x) => ({ learnerId: x.learnerId, mark: "present" as const })),
    });
    expect(r.ok).toBe(true);
    // Ben has no other access to the class.
    expect(await mockAttendance.getClassSummary(as("demo-teacher-2"), A2)).toBeNull();
    // Marked → history: the substitute can no longer be changed.
    expect(await mockSchedule.setSubstitute(as(S), id, null)).toEqual({
      ok: false,
      reason: "already_started",
    });

    expect((await mockSchedule.setSubstitute(as(S), "SES-001", TEACHER_BEN)).ok).toBe(true);
    const tara = (await mockTeacher.getDashboard(as("demo-teacher")))!;
    expect(tara.upcoming.find((s) => s.id === "SES-001")).toMatchObject({ coveredBy: "Ben" });
    const ben = (await mockTeacher.getDashboard(as("demo-teacher-2")))!;
    expect(ben.upcoming.find((s) => s.id === "SES-001")).toMatchObject({ asSubstitute: true });
  });
});
