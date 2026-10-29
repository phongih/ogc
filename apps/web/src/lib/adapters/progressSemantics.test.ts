import { describe, expect, it } from "vitest";
import { mockProgressView } from "./mockLearning";
import { learningStore } from "./store";
import {
  LEARNER_LINH,
  LEARNER_MINH,
} from "../../fixtures/personas";
import {
  LEARNER_HUY,
  LEARNER_THAO,
  learnerDirectory,
} from "../../fixtures/learners";
import { courses } from "../../fixtures/catalog";

const STAFF = "demo-staff"; // org staff: authorized to view same-org learners
const A2 = courses[0].id;
const B1 = courses[1].id;

describe("progress semantics — explicit states", () => {
  it("not_started when no activities are complete (Huy, B1)", () => {
    const p = learningStore.courseProgress(LEARNER_HUY, B1);
    expect(p.completedActivities).toBe(0);
    expect(p.state).toBe("not_started");
    expect(p.progressPct).toBe(0);
  });

  it("completed when every activity is done (Thao, B1)", () => {
    const p = learningStore.courseProgress(LEARNER_THAO, B1);
    expect(p.completedActivities).toBe(p.totalActivities);
    expect(p.state).toBe("completed");
    expect(p.progressPct).toBe(100);
  });

  it("in_progress for a partial course (Linh, A2) with deterministic weighted percent", () => {
    const p = learningStore.courseProgress(LEARNER_LINH, A2);
    expect(p.state).toBe("in_progress");
    // ACT-A2-1 (w1) + ACT-A2-2 (w1) of total weight 6 → 33%.
    expect(p.progressPct).toBe(33);
  });
});

describe("progress coverage — every roster learner has a snapshot", () => {
  it("returns progress for all org learners, including those with no login persona", async () => {
    const org1Learners = learnerDirectory.filter((l) => l.courseIds.length > 0);
    for (const l of org1Learners) {
      const summary = await mockProgressView.getLearnerProgress(STAFF, l.id);
      expect(summary, `learner ${l.displayName}`).not.toBeNull();
      expect(summary!.snapshots.length).toBe(l.courseIds.length);
    }
  });

  it("aggregates a learner-level overall percent and state", async () => {
    const huy = await mockProgressView.getLearnerProgress(STAFF, LEARNER_HUY);
    expect(huy!.state).toBe("not_started");
    expect(huy!.overallPct).toBe(0);

    const thao = await mockProgressView.getLearnerProgress(STAFF, LEARNER_THAO);
    expect(thao!.state).toBe("completed");
    expect(thao!.overallPct).toBe(100);
  });
});

describe("single source of truth — all roles see the same number", () => {
  it("learner-self, teacher and guardian report identical overall for Linh", async () => {
    const asLearner = await mockProgressView.getLearnerProgress("demo-learner", LEARNER_LINH);
    const asTeacher = await mockProgressView.getLearnerProgress("demo-teacher", LEARNER_LINH);
    const asGuardian = await mockProgressView.getLearnerProgress("demo-guardian", LEARNER_LINH);
    expect(asLearner!.overallPct).toBe(asTeacher!.overallPct);
    expect(asTeacher!.overallPct).toBe(asGuardian!.overallPct);
  });

  it("Minh (roster learner, has a persona) is also consistent across teacher view", async () => {
    const asTeacher = await mockProgressView.getLearnerProgress("demo-teacher", LEARNER_MINH);
    const direct = learningStore.courseProgress(LEARNER_MINH, A2).progressPct;
    expect(asTeacher!.snapshots[0].progressPct).toBe(direct);
  });
});
