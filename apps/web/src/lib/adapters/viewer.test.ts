// OGC-ADR-039 step 3b (learning ports): every port takes the IIOS-granted context; OGC derives its
// own account from the grant — tenant, principal AND role must match OGC's record, else nothing.
import { describe, expect, it } from "vitest";
import { as } from "../../test/grants";
import { ogcAccountOf } from "./viewer";
import { mockLearner } from "./mockLearner";
import { mockTeacher } from "./mockTeacher";
import { mockGuardian } from "./mockGuardian";
import { mockLearning } from "./mockLearning";
import { mockTutor } from "./mockTutor";
import { mockSupport } from "./mockProfile";
import { organizations } from "../../fixtures/directory";

const ORG2 = organizations[1].id;

describe("ogcAccountOf — OGC's account comes from the grant, never from the frontend", () => {
  it("maps a decided grant to the matching OGC record", () => {
    expect(ogcAccountOf(as("demo-learner"))).toBe("demo-learner");
    expect(ogcAccountOf(as("demo-teacher"))).toBe("demo-teacher");
    expect(ogcAccountOf(as("demo-admin"))).toBe("demo-admin"); // IIOS role staff + OGC staff record
  });

  it("a role that does not match the record, another tenant, or an unknown principal → nothing", () => {
    expect(ogcAccountOf({ ...as("demo-learner"), role: "teacher" })).toBe("");
    expect(ogcAccountOf({ ...as("demo-teacher"), role: "staff" })).toBe("");
    expect(ogcAccountOf({ ...as("demo-learner"), orgId: ORG2 })).toBe("");
    expect(ogcAccountOf(as("someone-else"))).toBe("");
  });
});

describe("learning ports refuse a grant that does not fit OGC's record", () => {
  it("a learner principal presented with a teacher role gets neither dashboard", async () => {
    const mismatched = { ...as("demo-learner"), role: "teacher" as const };
    expect(await mockLearner.getDashboard(mismatched)).toBeNull();
    expect(await mockTeacher.getDashboard(mismatched)).toBeNull();
    expect(await mockSupport.listNeedsSupport(mismatched)).toEqual([]);
  });

  it("the same principal in another tenant sees nothing", async () => {
    const elsewhere = { ...as("demo-learner"), orgId: ORG2 };
    expect(await mockLearner.getDashboard(elsewhere)).toBeNull();
    expect(await mockLearning.listMyProgress(elsewhere)).toEqual([]);
    expect(await mockTutor.listConversations(elsewhere)).toEqual([]);
  });

  it("the right grant still works", async () => {
    expect(await mockLearner.getDashboard(as("demo-learner"))).not.toBeNull();
    expect(await mockTeacher.getDashboard(as("demo-teacher"))).not.toBeNull();
    expect(await mockGuardian.getDashboard(as("demo-guardian"))).not.toBeNull();
  });
});
