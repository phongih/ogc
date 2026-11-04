import { describe, expect, it } from "vitest";
import type { PracticeActivity } from "@ogc/contracts";
import { PRACTICE_SCORING_VERSION, scorePractice } from "./scoring";

const activity: PracticeActivity = {
  activityId: "ACT-X",
  skill: "use_of_english",
  title: "Demo",
  prompt: "p",
  scoringVersion: PRACTICE_SCORING_VERSION,
  items: [
    { id: "q1", prompt: "1", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "a" },
    { id: "q2", prompt: "2", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "b" },
    { id: "q3", prompt: "3", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "a" },
    { id: "q4", prompt: "4", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correctOptionId: "b" },
  ],
};
const sub = (resp: Record<string, string>) => ({
  attemptId: "ATT-1",
  responses: Object.entries(resp).map(([itemId, optionId]) => ({ itemId, optionId })),
});

describe("AUTH-030 practice scorer — deterministic", () => {
  it("all correct → 100; stamps the scoring version and per-item results", () => {
    const r = scorePractice(activity, "L1", sub({ q1: "a", q2: "b", q3: "a", q4: "b" }));
    expect(r.score).toBe(100);
    expect(r.correct).toBe(4);
    expect(r.total).toBe(4);
    expect(r.scoringVersion).toBe(PRACTICE_SCORING_VERSION);
    expect(r.items.every((i) => i.correct)).toBe(true);
    expect(r.learnerId).toBe("L1");
  });

  it("all wrong → 0", () => {
    const r = scorePractice(activity, "L1", sub({ q1: "b", q2: "a", q3: "b", q4: "a" }));
    expect(r.score).toBe(0);
    expect(r.correct).toBe(0);
  });

  it("partial → round(correct/total*100); unanswered counts as incorrect", () => {
    const r = scorePractice(activity, "L1", sub({ q1: "a", q2: "b" })); // 2/4 answered correctly, q3/q4 blank
    expect(r.correct).toBe(2);
    expect(r.score).toBe(50);
    const q3 = r.items.find((i) => i.itemId === "q3")!;
    expect(q3.chosenOptionId).toBeNull();
    expect(q3.correct).toBe(false);
  });

  it("is deterministic and order-independent; last response per item wins; unknown items ignored", () => {
    const a = scorePractice(activity, "L1", {
      attemptId: "ATT-1",
      responses: [
        { itemId: "q4", optionId: "b" },
        { itemId: "nope", optionId: "x" }, // unknown item ignored
        { itemId: "q1", optionId: "b" },
        { itemId: "q1", optionId: "a" }, // later response wins → correct
        { itemId: "q2", optionId: "b" },
        { itemId: "q3", optionId: "a" },
      ],
    });
    const b = scorePractice(activity, "L1", sub({ q1: "a", q2: "b", q3: "a", q4: "b" }));
    expect(a.score).toBe(100);
    expect(a).toEqual(b); // same inputs (modulo order) → identical result
  });
});
