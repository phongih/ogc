// P2 · no double-booking: a teacher cannot teach two overlapping sessions, a room cannot hold two.
import { as } from "../../test/grants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCenterDraft } from "@ogc/contracts";
import { __resetAttendanceForTests } from "./mockAttendance";
import { mockSchedule } from "./mockSchedule";
import { mockMakeup } from "./mockMakeup";
import { mockCenterSetup } from "./mockCenterSetup";
import { sessionStore } from "./sessionStore";
import { brands } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { TEACHER_BEN, TEACHER_TARA } from "../../fixtures/personas";
import { classes } from "../../fixtures/teaching";

const S = "demo-staff";
const at = (id: string) => sessionStore.get(id)!.at;
// SES-001 A2 Morning (Tara) · SES-002 B1 Evening (Tara, Tue/Thu 18:00) · SES-003 A2 Evening (Ben, same slot)

beforeEach(() => __resetAttendanceForTests());

describe("schedule changes refuse double-bookings", () => {
  it("reschedule onto the teacher's other class", async () => {
    const r = await mockSchedule.reschedule(as(S), "SES-001", at("SES-002"));
    expect(r).toMatchObject({ ok: false, reason: "clash" });
    expect(!r.ok && r.clashes![0]).toMatch(/^Tara already teaches B1 Evening — Tue\/Thu on /);
    expect(sessionStore.get("SES-001")!.at).not.toBe(at("SES-002")); // unchanged
  });

  it("overlap counts, not only the same start (90-minute sessions)", async () => {
    const thirtyLater = new Date(Date.parse(at("SES-002")) + 30 * 60_000).toISOString();
    expect(await mockSchedule.reschedule(as(S), "SES-001", thirtyLater)).toMatchObject({
      reason: "clash",
    });
    const twoHoursLater = new Date(Date.parse(at("SES-002")) + 120 * 60_000).toISOString();
    expect((await mockSchedule.reschedule(as(S), "SES-001", twoHoursLater)).ok).toBe(true);
  });

  it("cancel-with-replacement, extra session, substitute and class teacher", async () => {
    expect(await mockSchedule.cancelWithReplacement(as(S), "SES-001", at("SES-002"))).toMatchObject(
      {
        reason: "clash",
      },
    );
    expect(sessionStore.get("SES-001")!.state).toBe("scheduled"); // nothing cancelled
    expect(
      await mockSchedule.addSession(as(S), classes[0].id, "Extra", at("SES-002")),
    ).toMatchObject({
      reason: "clash",
    });
    expect(await mockSchedule.setSubstitute(as(S), "SES-002", TEACHER_BEN)).toMatchObject({
      reason: "clash",
    });
    expect(await mockSchedule.assignTeacher(as(S), classes[1].id, TEACHER_BEN)).toMatchObject({
      reason: "clash",
    });
    expect((await mockSchedule.assignTeacher(as(S), classes[0].id, TEACHER_BEN)).ok).toBe(true); // Mon/Wed 09:00 is free
  });

  it("a make-up session cannot be opened when its teacher is busy", async () => {
    const huy1 = (await mockMakeup.getBoard(as(S)))!.items.find(
      (i) => i.unitTitle === "B1 — Unit 1",
    )!;
    const r = await mockMakeup.openMakeupSession(as(S), huy1.id, at("SES-003"), TEACHER_BEN);
    expect(r).toMatchObject({ ok: false, reason: "clash" });
    expect(!r.ok && r.clashes![0]).toMatch(/^Ben already teaches A2 Evening — Tue\/Thu on /);
  });
});

describe("center setup refuses double-bookings", () => {
  // These cases assert the weekday of the first upcoming colliding session ("on Tue,",
  // "on Sat,"). The adapter projects a draft class forward from Date.now() and keeps a
  // session "upcoming" until 4h after it starts, so a real clock makes the asserted
  // weekday depend on the time of day the suite runs (e.g. after 22:00 on a Tuesday the
  // 18:00 Tue session has dropped out and the next collision is Thursday). Freeze the
  // clock to Monday 04:00 of the current week — deterministic weekday, same week as the
  // now-relative fixtures. Only Date is faked, so timers stay real.
  beforeEach(() => {
    const real = new Date();
    const monday = new Date(real);
    monday.setDate(real.getDate() - ((real.getDay() + 6) % 7));
    monday.setHours(4, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(monday);
  });
  afterEach(() => vi.useRealTimers());

  const base = () => ({
    ...emptyCenterDraft(),
    brandId: brands[0].id,
    name: "Clash Center",
    code: "CL-1",
    courseIds: [courses[0].id],
    rooms: [{ name: "R1", capacity: 10 }],
  });
  const cls = (name: string, teacherId: string, weekdays: number[], time: string, room = "R1") => ({
    name,
    courseId: courses[0].id,
    room,
    weekdays,
    time,
    durationMin: 90,
    teacherId,
  });

  it("a new class at the time its teacher already teaches (the 21/11 live case)", async () => {
    const d = { ...base(), classes: [cls("B1 new", TEACHER_BEN, [2, 4, 6], "18:00")] };
    const preview = await mockCenterSetup.previewClashes(as(S), d);
    expect(preview[0]).toMatch(/^Ben already teaches A2 Evening — Tue\/Thu on Tue, /);
    expect(await mockCenterSetup.createCenter(as(S), d)).toMatchObject({
      ok: false,
      reason: "clash",
    });
  });

  it("two new classes in the same room at the same time; same teacher twice", async () => {
    const room = {
      ...base(),
      classes: [cls("A", TEACHER_TARA, [6], "10:00"), cls("B", TEACHER_BEN, [6], "10:30")],
    };
    expect((await mockCenterSetup.previewClashes(as(S), room))[0]).toMatch(
      /^R1 is already used by A \(new\) on Sat, /,
    );
    const twice = {
      ...base(),
      rooms: [
        { name: "R1", capacity: 10 },
        { name: "R2", capacity: 10 },
      ],
      classes: [cls("A", TEACHER_TARA, [6], "10:00"), cls("B", TEACHER_TARA, [6], "11:00", "R2")],
    };
    expect((await mockCenterSetup.previewClashes(as(S), twice))[0]).toMatch(
      /^Tara already teaches A \(new\) on Sat, /,
    );
  });

  it("a free slot opens fine, and its sessions then block later double-bookings", async () => {
    const d = { ...base(), classes: [cls("Sat A2", TEACHER_BEN, [6], "09:00")] };
    expect(await mockCenterSetup.previewClashes(as(S), d)).toEqual([]);
    const r = await mockCenterSetup.createCenter(as(S), d);
    expect(r.ok).toBe(true);
    const again = {
      ...d,
      code: "CL-2",
      name: "Again",
      classes: [cls("Sat 2", TEACHER_BEN, [6], "10:00")],
    };
    expect(await mockCenterSetup.previewClashes(as(S), again)).not.toEqual([]); // 09:00–10:30 overlaps 10:00
  });
});
