import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { courses } from "../../fixtures/catalog";

const A2 = courses[0].id;

describe("CourseLearning", () => {
  it("shows activities and lets the learner complete one, updating progress", async () => {
    renderApp(`/app/learning/courses/${A2}`, "learner");

    // The course progressbar renders once activities load.
    await waitFor(() => expect(screen.getByRole("progressbar")).toBeInTheDocument());

    // Complete a not-yet-done activity (the assessed quiz).
    const completeBtn = await waitFor(() =>
      screen.getByRole("button", { name: /Complete .*Quiz: At the market/i }),
    );
    await userEvent.click(completeBtn);

    // After completion the quiz's "Mark complete" button is gone (it now reads Completed).
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Complete .*Quiz: At the market/i })).toBeNull(),
    );
    // Completion is announced through a status region (a11y feedback).
    await waitFor(() => expect(screen.getByText(/activity marked complete/i)).toBeInTheDocument());
  });
});
