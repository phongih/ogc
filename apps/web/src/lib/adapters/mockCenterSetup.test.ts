// P2 · center setup wizard — checklist rules, staff-only, opening creates classes + sessions that
// every other P2 feature (schedule, attendance, teacher dashboard, directory) picks up.
import { beforeEach, describe, expect, it } from "vitest";
import type { CenterSetupDraft } from "@ogc/contracts";
import { centerSetupChecklist, classIssues, emptyCenterDraft } from "@ogc/contracts";
import { FIRST_WEEKS, mockCenterSetup } from "./mockCenterSetup";
import { __resetAttendanceForTests, mockAttendance } from "./mockAttendance";
import { mockSchedule } from "./mockSchedule";
import { mockTeacher } from "./mockTeacher";
import { mockDirectory } from "./mockDirectory";
import { sessionStore } from "./sessionStore";
import { brands, organizations } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { TEACHER_BEN } from "../../fixtures/personas";
import { classes } from "../../fixtures/teaching";

const S = "demo-staff";
const ORG = organizations[0].id;

function goodDraft(): CenterSetupDraft {
  return {
    ...emptyCenterDraft(),
    brandId: brands[0].id,
    name: "Nova English — Binh Thanh",
    code: "NV-BT",
    city: "Ho Chi Minh City",
    addressLine: "1 Synthetic Road",
    courseIds: [courses[0].id],
    rooms: [{ name: "Room A", capacity: 12 }],
    classes: [
      {
        name: "A2 Sat",
        courseId: courses[0].id,
        room: "Room A",
        weekdays: [6],
        time: "09:00",
        durationMin: 90,
        teacherId: TEACHER_BEN,
      },
    ],
  };
}

beforeEach(() => __resetAttendanceForTests());

describe("center setup checklist", () => {
  it("a complete draft passes; each missing piece fails its own line", () => {
    expect(centerSetupChecklist(goodDraft()).every((c) => c.ok)).toBe(true);
    const fail = (d: CenterSetupDraft, taken: string[] = []) =>
      centerSetupChecklist(d, taken)
        .filter((c) => !c.ok)
        .map((c) => c.key);
    expect(fail({ ...goodDraft(), code: "x" })).toEqual(["info"]);
    expect(fail(goodDraft(), ["NV-BT"])).toEqual(["info"]); // code taken in this org
    expect(fail({ ...goodDraft(), courseIds: [] })).toEqual(["courses", "classes"]);
    expect(fail({ ...goodDraft(), rooms: [{ name: "A", capacity: 0 }] })).toEqual([
      "rooms",
      "classes",
    ]);
    expect(fail({ ...goodDraft(), openFrom: "21:00", openTo: "08:00" })).toEqual([
      "days",
      "classes",
    ]);
    expect(fail({ ...goodDraft(), classes: [] })).toEqual(["classes"]);
  });

  it("explains what is wrong with a class in plain words", () => {
    const d = goodDraft();
    expect(classIssues(d, { ...d.classes[0], weekdays: [0] })).toContain(
      "meets on a day the center is closed",
    );
    expect(classIssues(d, { ...d.classes[0], time: "20:00" })).toContain(
      "is outside opening hours",
    );
    expect(classIssues(d, { ...d.classes[0], teacherId: "" })).toContain("needs a teacher");
  });
});

describe("opening a center", () => {
  it("is staff-only and re-checks the draft", async () => {
    for (const other of ["demo-teacher", "demo-learner", "demo-guardian"]) {
      expect(await mockCenterSetup.getSetupContext(other)).toBeNull();
      expect(await mockCenterSetup.createCenter(other, goodDraft())).toMatchObject({
        ok: false,
        reason: "not_staff",
      });
    }
    expect(await mockCenterSetup.createCenter(S, { ...goodDraft(), classes: [] })).toMatchObject({
      ok: false,
      reason: "incomplete",
      failed: ["classes"],
    });
    // A brand from another organization is refused even if the client checklist passed.
    expect(
      await mockCenterSetup.createCenter(S, { ...goodDraft(), brandId: brands[2].id }),
    ).toMatchObject({
      ok: false,
      failed: ["info"],
    });
    expect(
      await mockCenterSetup.createCenter(S, {
        ...goodDraft(),
        fees: [{ courseId: courses[0].id, amountVnd: 0, per: "course" }],
      }),
    ).toMatchObject({ ok: false, reason: "invalid_fee" });
  });

  it("creates the center, its class and 4 weeks of sessions that the rest of P2 uses", async () => {
    const r = await mockCenterSetup.createCenter(S, {
      ...goodDraft(),
      fees: [{ courseId: courses[0].id, amountVnd: 4_500_000, per: "course" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sessionsCreated).toBe(FIRST_WEEKS); // one weekday × 4 weeks
    // Directory lists it; its code is now taken.
    expect((await mockDirectory.listCenters(ORG)).some((c) => c.id === r.centerId)).toBe(true);
    expect((await mockCenterSetup.getSetupContext(S))!.takenCodes).toContain("NV-BT");
    expect(await mockCenterSetup.createCenter(S, goodDraft())).toMatchObject({
      ok: false,
      failed: ["info"],
    });
    // Schedule: Saturday 09:00 center time, in the future.
    const sessions = sessionStore.forClass(r.classIds[0]);
    expect(sessions).toHaveLength(FIRST_WEEKS);
    for (const s of sessions) {
      const local = new Date(Date.parse(s.at) + 7 * 3600_000);
      expect([local.getUTCDay(), local.getUTCHours(), Date.parse(s.at) > Date.now()]).toEqual([
        6,
        9,
        true,
      ]);
    }
    // Teacher dashboard, operations overview, attendance list all see the new class.
    const ben = (await mockTeacher.getDashboard("demo-teacher-2"))!;
    expect(ben.classes.map((c) => c.name)).toContain("A2 Sat — Sat");
    expect(
      (await mockSchedule.getOverview(S))!.classes.some((c) => c.classId === r.classIds[0]),
    ).toBe(true);
    expect(
      (await mockAttendance.listClassSessions("demo-teacher-2", r.classIds[0]))!.every(
        (s) => s.status === "upcoming",
      ),
    ).toBe(true);
    // Fees: mock price list, staff of the org only.
    expect(await mockCenterSetup.getFees(S, r.centerId)).toEqual([
      { courseId: courses[0].id, amountVnd: 4_500_000, per: "course", courseCode: "ENG-A2" },
    ]);
    expect(await mockCenterSetup.getFees("demo-staff-org2", r.centerId)).toBeNull();
  });

  it("reset removes created centers and classes", async () => {
    const before = classes.length;
    await mockCenterSetup.createCenter(S, goodDraft());
    expect(classes.length).toBe(before + 1);
    __resetAttendanceForTests();
    expect(classes.length).toBe(before);
  });
});
