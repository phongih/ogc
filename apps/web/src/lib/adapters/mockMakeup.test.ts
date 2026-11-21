import { nextWeeklySlot } from "../../fixtures/demoClock";
// P2 · make-up ledger: derived from attendance, closed only by attending a make-up, 14-day deadline.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockMakeup } from "./mockMakeup";
import { __resetAttendanceForTests, mockAttendance } from "./mockAttendance";
import { mockSchedule } from "./mockSchedule";
import { sessionStore } from "./sessionStore";
import { classes } from "../../fixtures/teaching";
import { seedSessions } from "../../fixtures/attendance";
import { TEACHER_BEN } from "../../fixtures/personas";
import { LEARNER_AN, LEARNER_HUY } from "../../fixtures/learners";

const S = "demo-staff";
const DAY = 86_400_000;
const A2 = classes[0].id;
const unit5 = () => seedSessions.find((s) => s.classId === A2 && s.title === "A2 — Unit 5")!;
const anItem = () => `${unit5().id}::${LEARNER_AN}`;
const board = async () => (await mockMakeup.getBoard(S))!;
const item = async (id: string) => (await board()).items.find((i) => i.id === id);
const at = (iso: string, plusMs: number) => new Date(Date.parse(iso) + plusMs);

beforeEach(() => __resetAttendanceForTests());
afterEach(() => vi.useRealTimers());

describe("make-up ledger — derived, never forgotten", () => {
  it("every absence in the learner's own class is an item, with a 14-day deadline", async () => {
    const b = await board();
    expect(b.items.map((i) => `${i.learnerName}|${i.unitTitle}`).sort()).toEqual([
      "An P.|A2 — Unit 5",
      "Huy D.|B1 — Unit 1",
      "Huy D.|B1 — Unit 2",
    ]);
    expect(b.counts).toEqual({ open: 3, booked: 0, toConfirm: 0, done: 0, overdue: 0 });
    const an = b.items.find((i) => i.learnerId === LEARNER_AN)!;
    expect(Date.parse(an.dueAt) - Date.parse(an.missedAt)).toBe(14 * DAY);
  });

  it("is staff-only, own tenant", async () => {
    for (const other of ["demo-teacher", "demo-teacher-2", "demo-learner", "demo-guardian"]) {
      expect(await mockMakeup.getBoard(other)).toBeNull();
      expect(await mockMakeup.book(other, anItem(), "SES-003")).toEqual({
        ok: false,
        reason: "not_staff",
      });
    }
    expect((await mockMakeup.getBoard("demo-staff-org2"))!.items).toEqual([]);
    expect(await mockMakeup.book("demo-staff-org2", anItem(), "SES-003")).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("a teacher's correction (absent → present) removes the item", async () => {
    const view = (await mockAttendance.getSessionAttendance("demo-teacher", unit5().id))!;
    await mockAttendance.recordAttendance("demo-teacher", unit5().id, {
      marks: view.rows.map((r) => ({ learnerId: r.learnerId, mark: "present" as const })),
    });
    expect(await item(anItem())).toBeUndefined();
  });
});

describe("make-up — join another class of the same unit", () => {
  it("offers A2 Evening's Unit 5; books An; Ben sees her as a make-up guest", async () => {
    const opts = (await mockMakeup.listOptions(S, anItem()))!;
    expect(opts).toEqual([
      expect.objectContaining({
        sessionId: "SES-003",
        kind: "join",
        className: "A2 Evening — Tue/Thu",
        teacherName: "Ben",
      }),
    ]);
    expect(await mockMakeup.book(S, anItem(), "SES-002")).toEqual({
      ok: false,
      reason: "not_an_option",
    });
    expect((await mockMakeup.book(S, anItem(), "SES-003")).ok).toBe(true);
    expect(await item(anItem())).toMatchObject({
      status: "booked",
      booking: { sessionId: "SES-003", kind: "join" },
    });
    const rows = (await mockAttendance.getSessionAttendance("demo-teacher-2", "SES-003"))!.rows;
    expect(rows.find((r) => r.learnerId === LEARNER_AN)).toMatchObject({
      makeupFor: "A2 Morning — Mon/Wed",
      mark: null,
    });
  });

  it("closes only when An is marked present at the make-up; absent there keeps it open", async () => {
    await mockMakeup.book(S, anItem(), "SES-003");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(sessionStore.get("SES-003")!.at, 60_000)); // the make-up has started
    const rows = (await mockAttendance.getSessionAttendance("demo-teacher-2", "SES-003"))!.rows;
    const mark = (an: "present" | "absent") =>
      mockAttendance.recordAttendance("demo-teacher-2", "SES-003", {
        marks: rows.map((r) => ({
          learnerId: r.learnerId,
          mark: r.learnerId === LEARNER_AN ? an : ("present" as const),
        })),
      });
    expect((await mark("absent")).ok).toBe(true);
    expect(await item(anItem())).toMatchObject({ status: "open", missedMakeup: true });
    expect((await mark("present")).ok).toBe(true);
    expect(await item(anItem())).toMatchObject({ status: "done", overdue: false });
    expect((await board()).counts.done).toBe(1);
    // A make-up is not class attendance: An's A2 Morning record is unchanged.
    const sum = (await mockAttendance.getClassSummary("demo-teacher", A2))!.find(
      (r) => r.learnerId === LEARNER_AN,
    )!;
    expect(sum).toMatchObject({ absent: 1, marked: 3 });
    expect(await mockMakeup.book(S, anItem(), "SES-004")).toEqual({
      ok: false,
      reason: "already_done",
    });
  });

  it("a booking follows its session when staff cancel it with a replacement", async () => {
    await mockMakeup.book(S, anItem(), "SES-003");
    const r = await mockSchedule.cancelWithReplacement(
      S,
      "SES-003",
      new Date(Date.now() + 9 * DAY).toISOString(),
    );
    const repl = r.ok ? r.classSchedule.sessions.find((s) => s.replaces === "SES-003")! : null;
    expect((await item(anItem()))!.booking!.sessionId).toBe(repl!.id);
  });
});

describe("make-up — a make-up session for everyone missing a unit", () => {
  it("B1 Unit 1 has no other class: staff open a make-up session with Ben; Huy is booked", async () => {
    const huy1 = (await board()).items.find(
      (i) => i.learnerId === LEARNER_HUY && i.unitTitle === "B1 — Unit 1",
    )!;
    expect(await mockMakeup.listOptions(S, huy1.id)).toEqual([]);
    expect(
      await mockMakeup.openMakeupSession(
        S,
        huy1.id,
        new Date(Date.now() - DAY).toISOString(),
        TEACHER_BEN,
      ),
    ).toEqual({
      ok: false,
      reason: "in_past",
    });
    const r = await mockMakeup.openMakeupSession(
      S,
      huy1.id,
      nextWeeklySlot([0, 1, 2, 3, 4, 5, 6], 14, 0, Date.now() + DAY), // 14:00 ICT: no class then
      TEACHER_BEN,
    );
    expect(r.ok).toBe(true);
    const booked = (await item(huy1.id))!;
    expect(booked).toMatchObject({
      status: "booked",
      booking: { kind: "makeup", teacherName: "Ben" },
    });
    const s = sessionStore.get(booked.booking!.sessionId!)!;
    expect(s).toMatchObject({
      kind: "makeup",
      classId: classes[1].id,
      substituteId: TEACHER_BEN,
      title: "B1 — Unit 1",
    });
    // Guests only; Ben (substitute) marks it; Huy's Unit 2 is a different unit — still open.
    expect(
      (await mockAttendance.getSessionAttendance("demo-teacher-2", s.id))!.rows.map(
        (x) => x.learnerId,
      ),
    ).toEqual([LEARNER_HUY]);
    expect((await board()).items.find((i) => i.unitTitle === "B1 — Unit 2")!.status).toBe("open");
  });
});

describe("make-up — deadline", () => {
  it("after 14 days an item not made up is overdue and listed first", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(unit5().at, 15 * DAY));
    const b = await board();
    expect(b.items[0]).toMatchObject({ learnerId: LEARNER_AN, overdue: true });
    expect(b.counts.overdue).toBeGreaterThanOrEqual(1);
  });
});
