import { as } from "../../test/grants";
import { nextWeeklySlot } from "../../fixtures/demoClock";
// P2 · slice 4 — self-study confirmed by the class teacher; learner / guardian see their make-ups;
// learner / guardian lesson times follow the live schedule; teacher dashboard labels make-ups.
import { beforeEach, describe, expect, it } from "vitest";
import { mockMakeup } from "./mockMakeup";
import { __resetAttendanceForTests, mockAttendance } from "./mockAttendance";
import { mockSchedule } from "./mockSchedule";
import { mockTeacher } from "./mockTeacher";
import { mockLearner } from "./mockLearner";
import { mockGuardian } from "./mockGuardian";
import { classes } from "../../fixtures/teaching";
import { seedSessions } from "../../fixtures/attendance";
import { LEARNER_LINH, TEACHER_BEN } from "../../fixtures/personas";

const S = "demo-staff";
const T = "demo-teacher";
const A2 = classes[0].id;
const DAY = 86_400_000;
const unit6 = () => seedSessions.find((s) => s.classId === A2 && s.title === "A2 — Unit 6")!.id;
const linhItem = () => `${unit6()}::${LEARNER_LINH}`;

async function linhAbsentAtUnit6() {
  const view = (await mockAttendance.getSessionAttendance(as(T), unit6()))!;
  await mockAttendance.recordAttendance(as(T), unit6(), {
    marks: view.rows.map((r) => ({
      learnerId: r.learnerId,
      mark: r.learnerId === LEARNER_LINH ? ("absent" as const) : ("present" as const),
    })),
  });
}

beforeEach(() => __resetAttendanceForTests());

describe("self-study make-up — counts only when the class teacher confirms", () => {
  it("assign → learner submits → teacher sends back → resubmits → teacher confirms", async () => {
    await linhAbsentAtUnit6();
    expect((await mockMakeup.assignSelfStudy(as(S), linhItem())).ok).toBe(true);
    const mine = await mockMakeup.listMine(as("demo-learner"));
    expect(mine).toEqual([
      expect.objectContaining({
        id: linhItem(),
        status: "booked",
        booking: expect.objectContaining({ kind: "selfstudy", teacherName: "Tara" }),
      }),
    ]);

    expect(await mockMakeup.submitSelfStudy(as("demo-learner"), linhItem(), "too short")).toEqual({
      ok: false,
      reason: "note_required",
    });
    expect(await mockMakeup.confirmSelfStudy(as(T), linhItem())).toEqual({
      ok: false,
      reason: "not_submitted",
    });
    expect(
      (
        await mockMakeup.submitSelfStudy(
          as("demo-learner"),
          linhItem(),
          "Read Unit 6 and did the exercises",
        )
      ).ok,
    ).toBe(true);
    expect((await mockMakeup.listToConfirm(as(T))).map((i) => i.id)).toEqual([linhItem()]);
    // Not Ben (not Linh's class teacher), not the guardian, not staff, not another learner.
    expect(await mockMakeup.listToConfirm(as("demo-teacher-2"))).toEqual([]);
    expect(await mockMakeup.confirmSelfStudy(as("demo-teacher-2"), linhItem())).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(
      await mockMakeup.submitSelfStudy(
        as("demo-guardian"),
        linhItem(),
        "Read Unit 6 and did the exercises",
      ),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await mockMakeup.submitSelfStudy(
        as("demo-learner-2"),
        linhItem(),
        "Read Unit 6 and did the exercises",
      ),
    ).toEqual({ ok: false, reason: "not_found" });

    const back = await mockMakeup.returnSelfStudy(
      as(T),
      linhItem(),
      "Please also do the listening task",
    );
    expect(back.ok && back.item).toMatchObject({
      status: "booked",
      booking: {
        selfStudy: { returnedNote: "Please also do the listening task", submittedAt: null },
      },
    });
    await mockMakeup.submitSelfStudy(
      as("demo-learner"),
      linhItem(),
      "Did the listening task as well",
    );
    const done = await mockMakeup.confirmSelfStudy(as(T), linhItem());
    expect(done.ok && done.item.status).toBe("done");
    expect((await mockMakeup.getBoard(as(S)))!.counts.done).toBe(1);
    expect(await mockMakeup.confirmSelfStudy(as(T), linhItem())).toEqual({
      ok: false,
      reason: "already_done",
    });
  });

  it("booking a session replaces self-study (an item is one or the other)", async () => {
    await linhAbsentAtUnit6();
    await mockMakeup.assignSelfStudy(as(S), linhItem());
    expect((await mockMakeup.book(as(S), linhItem(), "SES-004")).ok).toBe(true); // A2 Evening Unit 6
    const item = (await mockMakeup.listMine(as("demo-learner")))[0];
    expect(item.booking).toMatchObject({ kind: "join", sessionId: "SES-004" });
    expect(
      await mockMakeup.submitSelfStudy(
        as("demo-learner"),
        linhItem(),
        "Read Unit 6 and did the exercises",
      ),
    ).toEqual({
      ok: false,
      reason: "not_self_study",
    });
  });

  it("the guardian sees the linked learner's make-ups (read-only); others see none of them", async () => {
    await linhAbsentAtUnit6();
    expect((await mockMakeup.listMine(as("demo-guardian"))).map((i) => i.learnerId)).toEqual([
      LEARNER_LINH,
    ]);
    expect(await mockMakeup.listMine(as("demo-learner-2"))).toEqual([]);
    expect(await mockMakeup.listMine(as("demo-staff"))).toEqual([]);
    expect(await mockMakeup.listMine(as("demo-learner-org2"))).toEqual([]);
  });
});

describe("live schedule reaches every role", () => {
  it("learner and guardian lesson times follow a reschedule and a cancel-with-replacement", async () => {
    const moved = new Date(Date.now() + 4 * DAY).toISOString();
    await mockSchedule.reschedule(as(S), "SES-001", moved);
    let d = (await mockLearner.getDashboard(as("demo-learner")))!;
    expect(d.upcoming.find((l) => l.id === "LSN-A2-07")!.scheduledAt).toBe(moved);
    const repl = new Date(Date.now() + 6 * DAY).toISOString();
    await mockSchedule.cancelWithReplacement(as(S), "SES-001", repl);
    d = (await mockLearner.getDashboard(as("demo-learner")))!;
    expect(d.upcoming.find((l) => l.id === "LSN-A2-07")!.scheduledAt).toBe(repl);
    const g = (await mockGuardian.getDashboard(as("demo-guardian")))!;
    expect(g.links[0].nextSessionAt).toBe(repl);
  });

  it("a make-up session is labelled on the teacher dashboard and is not the class's next session", async () => {
    const huy1 = (await mockMakeup.getBoard(as(S)))!.items.find(
      (i) => i.unitTitle === "B1 — Unit 1",
    )!;
    const soon = nextWeeklySlot([0, 1, 2, 3, 4, 5, 6], 14); // next 14:00 ICT — no class then
    await mockMakeup.openMakeupSession(as(S), huy1.id, soon, TEACHER_BEN);
    const tara = (await mockTeacher.getDashboard(as(T)))!;
    expect(tara.upcoming.find((s) => s.title === "B1 — Unit 1")).toMatchObject({
      makeup: true,
      coveredBy: "Ben",
    });
    expect(tara.classes.find((c) => c.id === classes[1].id)!.nextSessionAt).not.toBe(soon);
    const ben = (await mockTeacher.getDashboard(as("demo-teacher-2")))!;
    expect(ben.upcoming.find((s) => s.title === "B1 — Unit 1")).toMatchObject({
      makeup: true,
      asSubstitute: true,
    });
  });
});
