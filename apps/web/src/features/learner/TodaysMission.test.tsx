// P1 · Today's mission — one next best action at the top of the learner home (SYNTHETIC).
import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import type { LearnerNextAction } from "@ogc/contracts";
import { renderApp, renderUI } from "../../test/harness";
import { TodaysMission, missionTitle } from "./TodaysMission";
import { practiceFor } from "../../fixtures/practice";
import { courses } from "../../fixtures/catalog";

const base: LearnerNextAction = {
  source: "system",
  activityId: "ACT-A2-3",
  courseId: courses[0].id,
  skill: "use_of_english",
  masteryLevel: 40,
  confidenceBand: "medium",
  friendlyReason: "This builds the skill you need most right now.",
  teacherNote: null,
};

describe("P1 · Today's mission", () => {
  it("is the first thing on the learner home, with exactly one primary action", async () => {
    renderApp("/app/learning", "learner");
    const card = await screen.findByLabelText("Today's mission");
    // before every other learner section
    const intel = await screen.findByRole("heading", { name: "Learning intelligence" });
    expect(card.compareDocumentPosition(intel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // one next action on the whole page — no second "Practice now"/"Start now" competing with it
    const primaries = [
      ...screen.queryAllByRole("link", { name: "Practice now" }),
      ...screen.queryAllByRole("link", { name: "Start now" }),
    ];
    expect(primaries).toHaveLength(1);
    expect(card.contains(primaries[0])).toBe(true);
    // friendly, no internal activity ids
    expect(within(card).getByTestId("li-recommendation-reason").textContent).not.toMatch(/ACT-/);
    expect(within(card).getByTestId("mission-title").textContent).not.toMatch(/ACT-/);
  });

  it("practice-enabled activity → 'Practice now' + the real question count (no invented duration)", () => {
    renderUI(<TodaysMission action={base} />);
    const n = practiceFor("ACT-A2-3")!.items.length;
    expect(screen.getByText(new RegExp(`${n} questions`))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Practice now" })).toHaveAttribute(
      "href",
      "/app/learning/practice/ACT-A2-3",
    );
    expect(screen.getByRole("link", { name: "Open the course" })).toHaveAttribute(
      "href",
      `/app/learning/courses/${courses[0].id}`,
    );
    expect(screen.queryByText(/min/)).toBeNull();
  });

  it("activity without a practice set → 'Start now' opens the course; no question count", () => {
    renderUI(<TodaysMission action={{ ...base, activityId: "ACT-A2-4", skill: "speaking" }} />);
    expect(screen.getByTestId("mission-title")).toHaveTextContent(
      "Speaking: Describe your weekend",
    );
    expect(screen.getByRole("link", { name: "Start now" })).toHaveAttribute(
      "href",
      `/app/learning/courses/${courses[0].id}`,
    );
    expect(screen.queryByRole("link", { name: "Practice now" })).toBeNull();
    expect(screen.queryByText(/questions/)).toBeNull();
  });

  it("teacher-applied mission shows the badge and the teacher's note", () => {
    renderUI(
      <TodaysMission
        action={{ ...base, source: "teacher", teacherNote: "Let's focus on speaking next" }}
      />,
    );
    expect(screen.getByText("Teacher recommended")).toBeInTheDocument();
    expect(screen.getByTestId("mission-teacher-note")).toHaveTextContent(
      "Let's focus on speaking next",
    );
  });

  it("system mission never shows a teacher note", () => {
    renderUI(<TodaysMission action={{ ...base, teacherNote: "should not render" }} />);
    expect(screen.getByText("Suggested for you")).toBeInTheDocument();
    expect(screen.queryByTestId("mission-teacher-note")).toBeNull();
  });

  it("nothing recommended → caught-up state with no action", () => {
    renderUI(<TodaysMission action={null} />);
    expect(screen.getByText(/all caught up/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("unknown activity falls back to a skill-based title", () => {
    expect(missionTitle({ ...base, activityId: "ACT-UNKNOWN", skill: "reading" })).toBe(
      "Reading practice",
    );
  });
});
