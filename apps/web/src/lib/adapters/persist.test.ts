// Demo data survives a reload: dump every registered store, reset to seed, restore → same state.
import { as } from "../../test/grants";
import { beforeEach, describe, expect, it } from "vitest";
import { emptyCenterDraft } from "@ogc/contracts";
import {
  DEMO_STORAGE_KEY,
  SCHEMA,
  clearDemoState,
  registeredKeys,
  followOtherTabs,
  restoreDemoState,
  saveDemoState,
} from "./persist";
import { __resetGrowthForTests, mockGrowth } from "./mockGrowth";
import { __resetAdmissionsForTests } from "./mockAdmissions";
import { __resetAttendanceForTests, mockAttendance } from "./mockAttendance";
import { mockCenterSetup } from "./mockCenterSetup";
import { mockMakeup } from "./mockMakeup";
import { mockSchedule } from "./mockSchedule";
import "./mockDecisionEngine"; // registers "engine" + "engineRules"
import { mockPractice } from "./mockPractice";
import { enrollmentStore, learningStore } from "./store";
import { sessionStore } from "./sessionStore";
import { brands } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { classes } from "../../fixtures/teaching";
import { LEARNER_LINH, TEACHER_BEN } from "../../fixtures/personas";

const S = "demo-staff";

beforeEach(() => {
  __resetAttendanceForTests();
  window.localStorage.clear();
});

describe("demo persistence", () => {
  it("every mock store is registered", () => {
    expect(registeredKeys().sort()).toEqual([
      "admissions",
      "attendance",
      "billing",
      "centerSetup",
      "engine",
      "engineRules",
      "growth",
      "iiosPolicy",
      "intelligence",
      "learning",
      "schedule",
      "studioLinks",
    ]);
  });

  it("a wizard center, a moved session, attendance, a make-up booking and practice all survive a reload", async () => {
    const r = await mockCenterSetup.createCenter(as(S), {
      ...emptyCenterDraft(),
      brandId: brands[0].id,
      name: "Kept Center",
      code: "KC-1",
      courseIds: [courses[0].id],
      rooms: [{ name: "R1", capacity: 10 }],
      fees: [{ courseId: courses[0].id, amountVnd: 1_000_000, per: "month" }],
      classes: [
        {
          name: "Sat",
          courseId: courses[0].id,
          room: "R1",
          weekdays: [6],
          time: "09:00",
          durationMin: 90,
          teacherId: TEACHER_BEN,
        },
      ],
    });
    expect(r.ok).toBe(true);
    const moved = new Date(Date.now() + 5 * 86_400_000).toISOString();
    await mockSchedule.reschedule(as(S), "SES-001", moved);
    const toMark = (await mockAttendance.listToMark(as("demo-teacher")))[0];
    const view = (await mockAttendance.getSessionAttendance(as("demo-teacher"), toMark.id))!;
    await mockAttendance.recordAttendance(as("demo-teacher"), toMark.id, {
      marks: view.rows.map((x) => ({
        learnerId: x.learnerId,
        mark: x.learnerId === LEARNER_LINH ? ("absent" as const) : ("present" as const),
      })),
    });
    const linhItem = `${toMark.id}::${LEARNER_LINH}`;
    await mockMakeup.assignSelfStudy(as(S), linhItem);
    await mockPractice.submitPractice(as("demo-learner"), "ACT-A2-3", {
      attemptId: "PERSIST-1",
      responses: [
        { itemId: "A2-3-Q1", optionId: "a" },
        { itemId: "A2-3-Q2", optionId: "b" },
      ],
    });
    const before = {
      classes: classes.length,
      evidence: learningStore.getEvidence(LEARNER_LINH, "ACT-A2-3").length,
      board: (await mockMakeup.getBoard(as(S)))!.counts,
    };

    saveDemoState();
    // A change AFTER the save must not survive the "reload".
    expect(enrollmentStore.enroll("demo-learner", courses[2].id).enrolled).toBe(true);
    __resetAttendanceForTests(); // "reload": schedule / attendance / centers back to seed
    expect(classes.length).toBeLessThan(before.classes);
    expect(sessionStore.get("SES-001")!.at).not.toBe(moved);

    expect(restoreDemoState()).toBe(true);
    expect(classes.length).toBe(before.classes);
    expect(classes.some((c) => c.name === "Sat — Sat")).toBe(true);
    expect(sessionStore.get("SES-001")!.at).toBe(moved);
    expect(
      (await mockAttendance.getSessionAttendance(as("demo-teacher"), toMark.id))!.session.status,
    ).toBe("marked");
    expect((await mockMakeup.getBoard(as(S)))!.counts).toEqual(before.board);
    expect((await mockMakeup.listMine(as("demo-learner")))[0].booking?.kind).toBe("selfstudy");
    expect(await mockCenterSetup.getFees(as(S), r.ok ? r.centerId : "")).toHaveLength(1);
    expect((await mockCenterSetup.getSetupContext(as(S)))!.takenCodes).toContain("KC-1");
    expect(learningStore.getEvidence(LEARNER_LINH, "ACT-A2-3").length).toBe(before.evidence);
    expect(before.evidence).toBeGreaterThan(0);
    expect(enrollmentStore.get("demo-learner", courses[2].id)).toBeUndefined(); // enrolled after the save
  });

  it("an old schema or a broken save is discarded, never breaks the app", () => {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ schema: SCHEMA - 1, data: {} }));
    expect(restoreDemoState()).toBe(false);
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    window.localStorage.setItem(DEMO_STORAGE_KEY, "{not json");
    expect(restoreDemoState()).toBe(false);
    window.localStorage.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({ schema: SCHEMA, data: { schedule: { sessions: 42 } } }),
    );
    expect(() => restoreDemoState()).not.toThrow();
    clearDemoState();
    expect(window.localStorage.getItem(DEMO_STORAGE_KEY)).toBeNull();
  });

  it("another tab's save reaches this tab's stores at once (owner 22/11: a /join referral never reached Sam's Funnel)", async () => {
    __resetGrowthForTests();
    __resetAdmissionsForTests();
    const changed: number[] = [];
    const stop = followOtherTabs(() => changed.push(1));
    // "Other tab": the friend sends the enquiry and that tab saves.
    const code = (await mockGrowth.getMine(as("demo-guardian")))!.code;
    expect(
      await mockGrowth.submitLead(code, {
        learnerName: "Bao T.",
        courseCode: "ENG-A2",
        centerName: "Nova English — District 1",
      }),
    ).toEqual({ ok: true });
    saveDemoState();
    const saved = window.localStorage.getItem(DEMO_STORAGE_KEY);
    // "This tab" loaded earlier: its in-memory stores have no lead (it lives in Admissions).
    __resetGrowthForTests();
    __resetAdmissionsForTests();
    expect(await mockGrowth.listLeads(as(S))).toEqual([]);
    window.dispatchEvent(new StorageEvent("storage", { key: DEMO_STORAGE_KEY, newValue: saved }));
    expect((await mockGrowth.listLeads(as(S)))!.map((l) => l.learnerName)).toEqual(["Bao T."]);
    expect(changed).toHaveLength(1);
    // Other keys are ignored.
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", newValue: "x" }));
    expect(changed).toHaveLength(1);
    stop();
  });
});
