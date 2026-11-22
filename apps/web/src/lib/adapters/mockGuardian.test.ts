import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockGuardianCanSelfVerify } from "@ogc/mock-authz";
import { mockGuardian } from "./mockGuardian";

const GUARDIAN = "demo-guardian";
const LEARNER = "demo-learner";

describe("mock guardian", () => {
  it("returns a dashboard with pre-established linked learners for a guardian", async () => {
    const d = await mockGuardian.getDashboard(as(GUARDIAN));
    expect(d).not.toBeNull();
    expect(d!.links.length).toBe(1);
    expect(d!.links[0].consentStatus).toBe("active");
  });

  // NEGATIVE: a non-guardian persona gets no guardian workspace (fail-closed).
  it("returns null for a non-guardian persona", async () => {
    expect(await mockGuardian.getDashboard(as(LEARNER))).toBeNull();
  });

  // NEGATIVE / D-14: there is no self-verification path; the guard always denies.
  it("never permits guardian self-verification (D-14)", () => {
    expect(mockGuardianCanSelfVerify()).toBe(false);
  });
});
