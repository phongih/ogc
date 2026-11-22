// Class courses (owner 22/11): a class follows one OGC-authored course (Course Studio); the class
// teacher proposes, staff link / reject / unlink; completion comes from the learners' own
// progress; prep hours count in Workforce; an engine rule (off by default) reads inactivity.
// SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as } from "../../test/grants";
import {
  __resetStudioLinksForTests,
  mockStudioLinks as L,
  studioInactiveLearners,
} from "./mockStudioLinks";
import { __resetWorkforceForTests, mockWorkforce as W } from "./mockWorkforce";
import { __resetCourseAuthoringForTests } from "./mockCourseAuthoring";
import { __resetCourseProgressForTests } from "./courseProgress";
import { __resetAttendanceForTests } from "./mockAttendance";
import { mockStudents } from "./mockStudents";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { classes } from "../../fixtures/teaching";

const S = "demo-staff";
const T = "demo-teacher"; // Tara
const SAM_P = "iios-principal-staff-1";
const A2M = classes[0].id; // A2 Morning (Tara, District 1)
const B1 = classes[1].id; // B1 Evening (Tara, Thu Duc)
const A2E = classes[2].id; // A2 Evening (Ben, District 1)

beforeEach(() => {
  __resetAttendanceForTests();
  __resetWorkforceForTests();
  __resetCourseAuthoringForTests();
  __resetCourseProgressForTests();
  __resetStudioLinksForTests();
});
afterEach(() => __attachForTests(SAM_P, null));

const links = async (who = S) => (await L.getOverview(as(who)))!.links;

describe("class courses — who sees what", () => {
  it("staff see their centers' classes; a teacher only their own; learners and guardians nothing", async () => {
    expect((await L.getOverview(as(S)))!).toMatchObject({ role: "staff", canLink: true });
    const t = (await L.getOverview(as(T)))!;
    expect(t.role).toBe("teacher");
    expect(t.classes.map((c) => c.id).sort()).toEqual([A2M, B1].sort());
    for (const p of ["demo-learner", "demo-guardian"])
      expect(await L.getOverview(as(p))).toBeNull();
    __attachForTests(SAM_P, "policy-front-desk-d1");
    expect((await L.getOverview(as(S)))!.classes.map((c) => c.id).sort()).toEqual(
      [A2M, A2E].sort(),
    );
  });
});

describe("class courses — propose, link, reject, unlink", () => {
  it("seed: A2 Morning linked; Tara's B1 proposal waits for staff", async () => {
    const l = await links();
    expect(l.find((x) => x.classId === A2M)).toMatchObject({
      status: "linked",
      course: { ref: "CS-A2-EVERYDAY" },
    });
    expect(l.find((x) => x.classId === B1)).toMatchObject({
      status: "proposed",
      mineToDecide: true,
    });
    expect((await links(T)).find((x) => x.classId === B1)!.mineToDecide).toBe(false);
  });

  it("only the class teacher proposes, only a course with a published version", async () => {
    expect(await L.propose(as("demo-teacher-2"), B1, "CS-IELTS-W1")).toMatchObject({
      reason: "not_allowed",
    });
    expect(await L.propose(as(T), B1, "CS-A2-PHONICS")).toMatchObject({ reason: "invalid_step" }); // never published
    expect(await L.propose(as(T), B1, "CS-LUMEN-STARTER")).toMatchObject({ reason: "not_found" }); // other org
    expect(await L.propose(as(T), B1, "CS-IELTS-W1")).toEqual({ ok: true });
    expect(await L.propose(as(T), B1, "CS-IELTS-W1")).toMatchObject({ reason: "invalid_step" });
  });

  it("staff link a proposal (one course per class), reject with a reason, unlink with a reason", async () => {
    const prop = (await links()).find((x) => x.classId === B1)!;
    expect(await L.link(as(T), B1, "CS-B1-SPEAK", 0)).toMatchObject({ reason: "not_allowed" });
    expect(await L.link(as(S), B1, "CS-B1-SPEAK", 11)).toMatchObject({ reason: "invalid" });
    expect(await L.link(as(S), B1, "CS-B1-SPEAK", 1.5)).toEqual({ ok: true });
    const linked = (await links()).find((x) => x.id === prop.id)!;
    expect(linked).toMatchObject({
      status: "linked",
      proposedBy: "Tara (Teacher)",
      prepHoursPerWeek: 1.5,
    });
    expect(await L.link(as(S), B1, "CS-IELTS-W1", 0)).toMatchObject({ reason: "invalid_step" });
    expect(await L.unlink(as(S), prop.id, "")).toMatchObject({ reason: "invalid" });
    expect(await L.unlink(as(S), prop.id, "course finished")).toEqual({ ok: true });
    await L.propose(as(T), B1, "CS-IELTS-W1");
    const p2 = (await links()).find((x) => x.status === "proposed" && x.classId === B1)!;
    expect(await L.reject(as(S), p2.id, "not this term")).toEqual({ ok: true });
    expect((await links()).find((x) => x.id === p2.id)).toMatchObject({
      status: "rejected",
      reason: "not this term",
    });
  });

  it("D1 front desk cannot decide for Thu Duc", async () => {
    __attachForTests(SAM_P, "policy-front-desk-d1");
    expect(await L.link(as(S), B1, "CS-B1-SPEAK", 0)).toMatchObject({ reason: "access_policy" });
  });
});

describe("class courses — only completion comes back", () => {
  it("per learner: lessons completed of the version they are on, last activity; nothing else", async () => {
    const id = (await links()).find((x) => x.classId === A2M)!.id;
    const rows = (await L.progress(as(S), id))!;
    expect(rows.map((r) => r.name).sort()).toEqual(["An P.", "Linh N.", "Minh T."]);
    for (const r of rows)
      expect(Object.keys(r).sort()).toEqual(
        [
          "completedLessons",
          "lastActivityAt",
          "learnerId",
          "name",
          "pct",
          "totalLessons",
          "version",
        ].sort(),
      );
    // An started on v1 (2 lessons) and stays there; the others get v2 (3 lessons).
    expect(rows.find((r) => r.name === "An P.")).toMatchObject({
      version: 1,
      completedLessons: 1,
      totalLessons: 2,
      pct: 50,
    });
    expect(rows.find((r) => r.name === "Linh N.")).toMatchObject({
      version: 2,
      completedLessons: 0,
      totalLessons: 3,
      lastActivityAt: null,
    });
    expect(await L.progress(as("demo-teacher-2"), id)).toBeNull(); // Ben: not his class
  });

  it("shows on Current Students", async () => {
    const cards = (await mockStudents.list(as(S)))!;
    const linh = cards.find((c) => c.name === "Linh N.")!;
    expect(linh.studio).toMatchObject({
      title: "A2 Everyday English — Units 6–8",
      totalLessons: 3,
    });
    expect(cards.find((c) => c.name === "Huy D.")!.studio).toBeNull(); // B1 not linked yet
  });

  it("engine hook: inactivity only for linked classes older than the window", () => {
    const org = classes[0].orgId;
    const idle = studioInactiveLearners(org, 14);
    expect(idle.map((x) => x.name).sort()).toEqual(["An P.", "Linh N.", "Minh T."]);
    for (const x of idle) expect(x.classId).toBe(A2M);
    expect(studioInactiveLearners(org, 19).map((x) => x.name)).not.toContain("An P."); // 18 days
    expect(studioInactiveLearners(org, 60)).toEqual([]); // linked 20 days ago — too new
  });
});

describe("class courses — prep hours count in Workforce", () => {
  it("0 by default; staff set 2 h → +2 h for the class teacher, as 'prep'", async () => {
    const before = (await W.getOverview(as(S)))!.teachers.find((t) => t.name === "Tara")!;
    const id = (await links()).find((x) => x.classId === A2M)!.id;
    expect(await L.setPrepHours(as(T), id, 2)).toMatchObject({ reason: "access_policy" });
    expect(await L.setPrepHours(as(S), id, 2)).toEqual({ ok: true });
    const after = (await W.getOverview(as(S)))!.teachers.find((t) => t.name === "Tara")!;
    expect(after.hours).toBe(before.hours + 2);
    expect(after.sessions).toBe(before.sessions);
    expect(after.breakdown.find((b) => b.kind === "prep")).toMatchObject({ hours: 2, sessions: 0 });
  });
});

describe("class courses — search", () => {
  it("staff find every course of the org; a teacher published ones and their own", async () => {
    const refs = async (who: string) => (await L.searchCourses(as(who), ""))!.map((c) => c.ref);
    expect(await refs(S)).toContain("CS-A2-PHONICS");
    expect(await refs(T)).not.toContain("CS-A2-PHONICS");
    expect(await refs("demo-teacher-2")).toContain("CS-A2-PHONICS"); // Ben's own
    expect(await refs(S)).not.toContain("CS-LUMEN-STARTER");
  });
});
