// P2 · center setup wizard in the UI: steps, checklist, open → success, new class visible.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { classes } from "../../fixtures/teaching";

beforeEach(() => {
  __resetAttendanceForTests();
  window.localStorage.clear();
});

describe("Set up a new center", () => {
  it("walks the steps; the checklist gates opening; opening creates the class and sessions", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/centers/new", "staff");
    const checklist = await screen.findByRole("complementary", { name: "Checklist" });
    expect(within(checklist).getByText(/Checklist · 1\/5/)).toBeInTheDocument(); // default opening days

    await user.type(screen.getByLabelText("Center name"), "Nova English — Binh Thanh");
    await user.type(screen.getByLabelText(/Center code/), "nv-bt");
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByLabelText(/ENG-A2/));
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByRole("button", { name: "+ Add room" }));
    await user.click(screen.getByRole("button", { name: "Next →" }));
    await user.click(screen.getByRole("button", { name: "+ Add class" }));
    expect(
      screen.getByText(/This class needs at least one weekday, needs a teacher\./),
    ).toBeInTheDocument();
    await user.click(
      within(screen.getByRole("group", { name: "Class 1 days" })).getByLabelText("Sat"),
    );
    await user.selectOptions(screen.getByLabelText("Class 1 teacher"), "Ben");
    expect(within(checklist).getByText(/Checklist · 5\/5/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "6. Review & open" }));
    await user.click(screen.getByRole("button", { name: "Open Nova English — Binh Thanh" }));
    expect(
      await screen.findByText(/Center opened · 1 class · 4 sessions scheduled/),
    ).toBeInTheDocument();
    expect(classes.some((c) => c.name === "Class 1 — Sat")).toBe(true);
    expect(window.localStorage.getItem("ogc.centerSetup.draft.demo-staff")).toBeNull(); // draft cleared
  });

  it("keeps the draft in this browser and offers to discard it", async () => {
    window.localStorage.setItem(
      "ogc.centerSetup.draft.demo-staff",
      JSON.stringify({ name: "Half done" }),
    );
    const user = userEvent.setup();
    renderApp("/app/operations/centers/new", "staff");
    expect(
      await screen.findByText(/Unsaved progress restored from this browser/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Center name")).toHaveValue("Half done");
    await user.click(screen.getByRole("button", { name: "discard" }));
    expect(screen.getByLabelText("Center name")).toHaveValue("");
  });

  it("is closed to teachers", async () => {
    renderApp("/app/operations/centers/new", "teacher");
    expect(await screen.findByText(/hidden for the current demo persona/)).toBeInTheDocument();
  });
});
