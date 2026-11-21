import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/harness";
import { courses } from "../../fixtures/catalog";
import { learningStore } from "../../lib/adapters/store";

const A2 = courses[0].id;

describe("CourseLearning", () => {
  it("a blocked activity cannot be started: it says which activity to finish first", async () => {
    // Runs first (shared module store): Linh has not done the quiz, so the speaking activity is locked.
    renderApp(`/app/learning/courses/${A2}`, "learner");
    expect(await screen.findByTestId("locked-ACT-A2-4")).toHaveTextContent(
      "Finish “Quiz: At the market” first",
    );
    expect(screen.queryByRole("link", { name: "Open speaking studio" })).toBeNull();
  });

  it("a quiz with a practice set has no 'Mark complete' — it opens the practice", async () => {
    renderApp(`/app/learning/courses/${A2}`, "learner");
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());
    const link = await screen.findByRole("link", { name: "Practice now" });
    expect(link).toHaveAttribute("href", "/app/learning/practice/ACT-A2-3");
    expect(screen.queryByRole("button", { name: /Complete .*Quiz: At the market/i })).toBeNull();
    // finish the prerequisite for the next test (shared module store)
    learningStore.complete("demo-learner", "ACT-A2-3");
  });

  it("a speaking activity has no 'Mark complete' — it opens the Speaking studio (teacher review)", async () => {
    renderApp(`/app/learning/courses/${A2}`, "learner");
    const link = await screen.findByRole("link", { name: "Open speaking studio" });
    expect(link).toHaveAttribute("href", "/app/learning/speaking/ACT-A2-4");
    expect(screen.queryByRole("button", { name: /Complete .*Speaking/i })).toBeNull();
  });
});
