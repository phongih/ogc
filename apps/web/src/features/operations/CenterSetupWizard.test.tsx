// P2 · center setup wizard in the UI: steps, checklist, open → success, new class visible.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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
    const openBtn = screen.getByRole("button", { name: "Open Nova English — Binh Thanh" });
    await waitFor(() => expect(openBtn).toBeEnabled()); // after the clash preview
    await user.click(openBtn);
    expect(
      await screen.findByText(/Center opened · 1 class · 4 sessions scheduled/),
    ).toBeInTheDocument();
    expect(classes.some((c) => c.name === "Class 1 — Sat")).toBe(true);
    expect(window.localStorage.getItem("ogc.centerSetup.draft.iios-principal-staff-1")).toBeNull(); // draft cleared
  });

  it("review lists a teacher double-booking and will not open the center", async () => {
    // Ben already teaches A2 Evening on Tue/Thu 18:00 — a new Tue 18:00 class for Ben clashes.
    const draft = {
      brandId: "00000000-0000-4000-8000-0000000000a1",
      name: "Clash Center",
      code: "CL-1",
      city: "HCMC",
      addressLine: "",
      courseIds: ["00000000-0000-4000-8000-000000000e01"],
      rooms: [{ name: "R1", capacity: 10 }],
      openDays: [1, 2, 3, 4, 5, 6],
      openFrom: "08:00",
      openTo: "21:00",
      classes: [
        {
          name: "Tue evening",
          courseId: "00000000-0000-4000-8000-000000000e01",
          room: "R1",
          weekdays: [2],
          time: "18:00",
          durationMin: 90,
          teacherId: "00000000-0000-4000-8000-00000000t002",
        },
      ],
      fees: [],
    };
    window.localStorage.setItem("ogc.centerSetup.draft.iios-principal-staff-1", JSON.stringify(draft));
    const user = userEvent.setup();
    renderApp("/app/operations/centers/new", "staff");
    await user.click(await screen.findByRole("button", { name: "6. Review & open" }));
    const alert = await screen.findByRole("alert", { name: "Schedule clashes" });
    expect(
      within(alert).getAllByText(/^Ben already teaches A2 Evening — Tue\/Thu on Tue, /).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Open Clash Center" })).toBeDisabled();
  });

  it("keeps the draft in this browser and offers to discard it", async () => {
    window.localStorage.setItem(
      "ogc.centerSetup.draft.iios-principal-staff-1",
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
