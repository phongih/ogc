import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { classes } from "../../fixtures/teaching";

const CLASS = classes[0].id; // owned by the demo teacher

describe("LessonPlanEditor", () => {
  it("saves a complete draft plan", async () => {
    renderApp(`/app/teaching/classes/${CLASS}/plan`, "teacher");

    const title = await waitFor(() => screen.getByLabelText("Lesson plan title"));
    await userEvent.type(title, "Unit 7 — Making plans");
    await userEvent.type(screen.getByLabelText("Objectives"), "Use 'be going to'");
    await userEvent.type(screen.getByLabelText("Activities"), "Pair practice | 20");
    await userEvent.type(screen.getByLabelText("Assessment"), "Exit ticket");

    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));
    await waitFor(() => expect(screen.getByText(/lesson plan saved/i)).toBeInTheDocument());
  });

  it("blocks marking a plan 'ready' when required fields are missing", async () => {
    renderApp(`/app/teaching/classes/${CLASS}/plan`, "teacher");

    const title = await waitFor(() => screen.getByLabelText("Lesson plan title"));
    await userEvent.type(title, "Incomplete plan");
    await userEvent.click(screen.getByLabelText("Ready"));
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    const alert = await waitFor(() => screen.getByRole("alert"));
    expect(alert).toHaveTextContent(/objective/i);
  });
});
