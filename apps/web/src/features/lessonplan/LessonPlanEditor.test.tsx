import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { classes } from "../../fixtures/teaching";
import { draftCache } from "./draftCache";

const CLASS = classes[0].id; // owned by the demo teacher

describe("LessonPlanEditor", () => {
  // Isolate the in-session autosave cache between tests.
  beforeEach(() => draftCache.clear(CLASS));

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

  it("autosaves the working draft in-session and restores it on return", async () => {
    const { unmount } = renderApp(`/app/teaching/classes/${CLASS}/plan`, "teacher");
    const title = await waitFor(() => screen.getByLabelText("Lesson plan title"));
    await userEvent.type(title, "Draft WIP title");
    await waitFor(() => expect(screen.getByText(/draft autosaved in this session/i)).toBeInTheDocument());
    unmount();

    // Returning to the editor restores the unsaved draft from the in-memory cache.
    renderApp(`/app/teaching/classes/${CLASS}/plan`, "teacher");
    await waitFor(() => expect(screen.getByLabelText("Lesson plan title")).toHaveValue("Draft WIP title"));
  });
});
