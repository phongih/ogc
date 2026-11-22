// Current Students (owner 22/11): three care levels with evidence, no psychological labels;
// staff (policy centers) and own class teachers only; tuition is information for staff and never
// changes the care level; thresholds follow the Decision Engine's rules. SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { as } from "../../test/grants";
import { mockStudents as St } from "./mockStudents";
import { mockDecisionEngine as E } from "./mockDecisionEngine";
import { __resetAttendanceForTests } from "./mockAttendance";
import { __resetBillingForTests } from "./mockBilling";
import { __attachForTests } from "../integration/mockIiosPolicy";
import { centers } from "../../fixtures/directory";

const SAM_P = "iios-principal-staff-1";
const TARA_P = "iios-principal-teacher-1";
const names = (xs: { name: string }[] | null) => (xs ?? []).map((x) => x.name).sort();

beforeEach(() => {
  __resetAttendanceForTests(); // resets the shared session store, engine rules, make-ups
  __resetBillingForTests();
});
afterEach(() => {
  __attachForTests(SAM_P, null);
  __attachForTests(TARA_P, null);
});

describe("current students — who sees whom", () => {
  it("staff: every learner; a class teacher: own classes; learners, guardians, another org: nothing", async () => {
    expect((await St.list(as("demo-staff")))!.length).toBe(7);
    expect(names(await St.list(as("demo-teacher")))).toEqual([
      "An P.",
      "Huy D.",
      "Linh N.",
      "Minh T.",
      "Thao V.",
    ]);
    expect(names(await St.list(as("demo-teacher-2")))).toEqual(["Khoa L.", "Vy H."]);
    for (const p of ["demo-learner", "demo-guardian", "demo-learner-2"])
      expect(await St.list(as(p))).toBeNull();
    expect(await St.list(as("demo-staff-org2"))).toEqual([]);
  });

  it("access policy: Front desk sees District 1 only; a policy without students:view sees nothing", async () => {
    __attachForTests(SAM_P, "policy-front-desk-d1");
    const d1 = (await St.list(as("demo-staff")))!;
    expect(d1.every((c) => c.classes.every((k) => k.centerId === centers[0].id))).toBe(true);
    expect(names(d1)).toEqual(["An P.", "Khoa L.", "Linh N.", "Minh T.", "Vy H."]);
    __attachForTests(TARA_P, "policy-own-classes");
    expect((await St.list(as("demo-teacher")))!.length).toBe(5);
  });
});

describe("current students — care level with evidence", () => {
  it("levels come with plain evidence; tuition never changes the level; teachers see no tuition", async () => {
    const all = (await St.list(as("demo-staff")))!;
    const huy = all.find((c) => c.name === "Huy D.")!;
    expect(huy.care.level).toBe("support");
    expect(huy.care.evidence[0].text).toBe("Absent from the last 2 marked sessions (attendance)");
    expect(huy.recommendations.map((r) => r.kind)).toContain("absence_streak");
    const an = all.find((c) => c.name === "An P.")!;
    expect(an.care.level).toBe("watch");
    expect(an.care.evidence.map((e) => e.text)).toContain(
      "Attended 2 of 3 marked sessions (66.7%, below 80%)",
    );
    const vy = all.find((c) => c.name === "Vy H.")!;
    expect(vy.tuition).toEqual({ balanceVnd: 6_900_000, overdueVnd: 6_900_000 });
    expect(vy.care).toEqual({ level: "ok", evidence: [] }); // overdue tuition is not a care signal
    expect(all[0].name).toBe("Huy D."); // needs support first
    expect((await St.list(as("demo-teacher")))!.every((c) => c.tuition === null)).toBe(true);
    // No psychological labels anywhere.
    const text = JSON.stringify(all).toLowerCase();
    for (const w of ["overwhelmed", "struggling", "flourishing", "pressure", "at risk"])
      expect(text).not.toContain(w);
  });

  it("thresholds follow the Decision Engine: pausing the absence rule removes that evidence", async () => {
    const rule = (await E.listRules(as("demo-staff")))!.find((r) => r.kind === "absence_streak")!;
    expect(await E.updateRule(as("demo-staff"), rule.id, { enabled: false })).toMatchObject({
      ok: true,
    });
    const huy = (await St.list(as("demo-staff")))!.find((c) => c.name === "Huy D.")!;
    expect(huy.care.evidence.map((e) => e.kind)).not.toContain("absence_streak");
  });
});
