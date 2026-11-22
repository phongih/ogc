// Workforce · Teacher Load (owner 22/11): hours in the next 7 days from OGC's schedule, per-teacher
// targets, bands as % of target, suggestions that never assign and never block. SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as } from "../../test/grants";
import { __resetWorkforceForTests, mockWorkforce as W } from "./mockWorkforce";
import { __resetAttendanceForTests } from "./mockAttendance";
import { mockSchedule } from "./mockSchedule";
import { sessionStore } from "./sessionStore";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { classTeachers, classes } from "../../fixtures/teaching";
import { TEACHER_BEN, TEACHER_MIA, TEACHER_TARA } from "../../fixtures/personas";

const S = "demo-staff";
const SAM_P = "iios-principal-staff-1";
const byName = async () =>
  Object.fromEntries((await W.getOverview(as(S)))!.teachers.map((t) => [t.name, t]));

beforeEach(() => {
  __resetAttendanceForTests(); // resets the shared schedule
  __resetWorkforceForTests();
});
afterEach(() => __attachForTests(SAM_P, null));

describe("workforce — load from the schedule", () => {
  it("staff only; hours = real session lengths in the next 7 days; bands as % of each target", async () => {
    for (const p of ["demo-teacher", "demo-learner", "demo-guardian"])
      expect(await W.getOverview(as(p))).toBeNull();
    const t = await byName();
    expect(Object.keys(t).sort()).toEqual(["Ben", "Khang", "Mia", "Tara"]);
    expect(t.Tara).toMatchObject({ hours: 3, targetHours: 2.5, pct: 120, band: "over" });
    expect(t.Ben).toMatchObject({ hours: 3, targetHours: 4, pct: 75, band: "meet" });
    expect(t.Mia).toMatchObject({ hours: 0, band: "under" });
    const o = (await W.getOverview(as(S)))!;
    expect(o.bands).toEqual({ over: 1, meet: 1, under: 2 });
    expect(o.teachers[0].name).toBe("Tara"); // most loaded first
  });

  it("a substitute's session counts for the substitute, not the class teacher", async () => {
    const s = sessionStore
      .all()
      .find(
        (x) =>
          x.classId === classes[0].id && x.state === "scheduled" && Date.parse(x.at) > Date.now(),
      )!;
    expect(await mockSchedule.setSubstitute(as(S), s.id, TEACHER_MIA)).toMatchObject({ ok: true });
    const t = await byName();
    expect(t.Mia).toMatchObject({ hours: 1.5, sessions: 1 });
    expect(t.Mia.breakdown[0]).toMatchObject({ kind: "substitute", hours: 1.5 });
    expect(t.Tara.hours).toBe(1.5);
  });
});

describe("workforce — targets and thresholds (staff tune; workforce:manage)", () => {
  it("set a target; thresholds move the bands; bad values and a narrowed policy are refused", async () => {
    expect(await W.setTarget(as(S), TEACHER_TARA, "full_time", 20)).toEqual({ ok: true });
    expect((await byName()).Tara).toMatchObject({
      employment: "full_time",
      pct: 15,
      band: "under",
    });
    for (const h of [0, 41, 2.3])
      expect(await W.setTarget(as(S), TEACHER_TARA, "part_time", h)).toMatchObject({
        reason: "invalid",
      });
    expect(await W.updateSettings(as(S), { underPct: 10, overPct: 100 })).toEqual({ ok: true });
    expect((await byName()).Tara.band).toBe("meet");
    expect(await W.updateSettings(as(S), { underPct: 10, overPct: 90 })).toMatchObject({
      reason: "invalid",
    });
    __attachForTests(SAM_P, "policy-front-desk-d1");
    expect(await W.setTarget(as(S), TEACHER_BEN, "part_time", 5)).toMatchObject({
      reason: "access_policy",
    });
    expect(await W.setTarget(as("demo-teacher"), TEACHER_BEN, "part_time", 5)).toMatchObject({
      reason: "not_staff",
    });
  });
});

describe("workforce — suggestions (never assign, never block)", () => {
  it("class teacher: ranked by load after, clashes last, over-target warned; nothing changes", async () => {
    const cls = classes[0];
    const before = classTeachers[cls.id];
    const c = (await W.suggestForClass(as(S), cls.id))!;
    expect(c.map((x) => x.name)).not.toContain("Tara"); // the current class teacher
    expect(c[c.length - 1]).toMatchObject({ name: "Ben" });
    expect(c.find((x) => x.name === "Ben")!.note).toMatch(/Would go over target/);
    expect(c.find((x) => x.name === "Mia")).toMatchObject({
      before: { hours: 0 },
      after: { hours: 1.5 },
    });
    expect(classTeachers[cls.id]).toBe(before); // suggesting assigns nothing
  });

  it("substitute: a teacher busy at that time is flagged with the clash", async () => {
    const s = sessionStore
      .all()
      .find(
        (x) =>
          x.classId === classes[0].id && x.state === "scheduled" && Date.parse(x.at) > Date.now(),
      )!;
    // Mia substitutes another class at the same time — light load, but busy then.
    const other = sessionStore.add({ classId: classes[2].id, title: "Clash test", at: s.at });
    expect(await mockSchedule.setSubstitute(as(S), other.id, TEACHER_MIA)).toMatchObject({
      ok: true,
    });
    const list = (await W.suggestForSession(as(S), s.id))!;
    const mia = list.find((x) => x.name === "Mia")!;
    expect(mia.after.band).toBe("meet"); // would be the best fit by load alone…
    expect(mia.clashes.length).toBe(1);
    expect(mia.note).toBe("Schedule clash");
    expect(list.at(-1)!.name).toBe("Mia"); // …but a clash ranks last
  });

  it("new class: weekly minutes added to each teacher's current load", async () => {
    const c = (await W.suggestForNewClass(as(S), 180))!;
    expect(c.find((x) => x.name === "Mia")!.after).toMatchObject({ hours: 3, band: "meet" });
    expect(await W.suggestForNewClass(as("demo-teacher"), 180)).toBeNull();
  });
});
