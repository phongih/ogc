import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockProgressView } from "./mockLearning";
import { LEARNER_LINH, LEARNER_MINH } from "../../fixtures/personas";

const LEARNER = "demo-learner"; // LINH
const TEACHER = "demo-teacher"; // owns classes with LINH on the roster
const GUARDIAN = "demo-guardian"; // linked to LINH only
const STAFF = "demo-staff"; // org1 staff/admin
const STAFF_ORG2 = "demo-staff-org2"; // different tenant root

describe("cross-role progress view — authorization", () => {
  it("a learner sees their own progress", async () => {
    const summary = await mockProgressView.getLearnerProgress(as(LEARNER), LEARNER_LINH);
    expect(summary).not.toBeNull();
    expect(summary!.snapshots.length).toBeGreaterThan(0);
    expect(summary!.learnerId).toBe(LEARNER_LINH);
  });

  it("a teacher sees progress for an assigned-class learner", async () => {
    const snaps = await mockProgressView.getLearnerProgress(as(TEACHER), LEARNER_LINH);
    expect(snaps).not.toBeNull();
  });

  it("a guardian sees progress for a linked learner", async () => {
    const snaps = await mockProgressView.getLearnerProgress(as(GUARDIAN), LEARNER_LINH);
    expect(snaps).not.toBeNull();
  });

  it("org staff sees progress for a same-org learner", async () => {
    const snaps = await mockProgressView.getLearnerProgress(as(STAFF), LEARNER_LINH);
    expect(snaps).not.toBeNull();
  });

  // NEGATIVE: a guardian cannot see a learner they are not linked to.
  it("denies a guardian viewing a non-linked learner", async () => {
    expect(await mockProgressView.getLearnerProgress(as(GUARDIAN), LEARNER_MINH)).toBeNull();
  });

  // NEGATIVE: a learner cannot see another learner's progress.
  it("denies a learner viewing another learner", async () => {
    expect(await mockProgressView.getLearnerProgress(as(LEARNER), LEARNER_MINH)).toBeNull();
  });

  // NEGATIVE: cross-org — staff in another tenant root cannot see this org's learner.
  it("denies cross-org staff viewing a learner in a different organization", async () => {
    expect(await mockProgressView.getLearnerProgress(as(STAFF_ORG2), LEARNER_LINH)).toBeNull();
  });

  // NEGATIVE: an unknown viewer persona is denied.
  it("denies an unknown viewer persona", async () => {
    expect(
      await mockProgressView.getLearnerProgress(as("no-such-persona"), LEARNER_LINH),
    ).toBeNull();
  });
});
