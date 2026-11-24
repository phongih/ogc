// P2 · Center operations page (staff): cancel-with-replacement and substitute, in the UI.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { sessionStore } from "../../lib/adapters/sessionStore";

beforeEach(() => __resetAttendanceForTests());
afterEach(() => vi.useRealTimers());

describe("Center operations", () => {
  it("staff cancel a session only with a replacement time; the class keeps the lesson", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    const a2 = await screen.findByRole("region", { name: "A2 Morning — Mon/Wed" });
    await user.click(within(a2).getByRole("button", { name: "Cancel A2 — Unit 7" }));
    const when = within(a2).getByLabelText("Replacement time for A2 — Unit 7");
    expect(when).toBeRequired();
    expect((when as HTMLInputElement).value).not.toBe(""); // prefilled: a day after the session
    await user.click(within(a2).getByRole("button", { name: "Cancel and replace" }));
    expect(await within(a2).findByText(/^Cancelled → moved to /)).toBeInTheDocument();
    expect(within(a2).getByText("Upcoming · replacement")).toBeInTheDocument();
    expect(sessionStore.get("SES-001")!.state).toBe("cancelled");
  });

  it("staff put a substitute on a started, unmarked session", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    const a2 = await screen.findByRole("region", { name: "A2 Morning — Mon/Wed" });
    const sel = within(a2).getByLabelText("Teacher for A2 — Unit 6") as HTMLSelectElement;
    await user.selectOptions(sel, "Ben (substitute)");
    await waitFor(() =>
      expect(
        sessionStore.all().find((s) => s.title === "A2 — Unit 6")!.substituteId,
      ).not.toBeNull(),
    );
    expect(within(a2).getByText("Started · not marked yet")).toBeInTheDocument();
  });

  it("staff reassign a class teacher (no clash: Ben is free Mon/Wed 09:00)", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    const a2 = await screen.findByRole("region", { name: "A2 Morning — Mon/Wed" });
    await user.selectOptions(
      within(a2).getByLabelText("Class teacher for A2 Morning — Mon/Wed"),
      "Ben",
    );
    await waitFor(() =>
      expect(
        within(a2).getByLabelText("Class teacher for A2 Morning — Mon/Wed"),
      ).toHaveDisplayValue("Ben"),
    );
  });

  it("reassigning B1 Evening to Ben is refused: he already teaches A2 Evening Tue/Thu 18:00", async () => {
    // The clash alert names the first upcoming colliding session ("on Tue,"). The adapter
    // projects from Date.now() and drops a session 4h after it starts, so a real clock
    // makes the weekday depend on the run time (after 22:00 Tue the next collision is Thu).
    // Freeze the clock to Monday 04:00 of the current week; only Date is faked so the
    // testing-library/userEvent timers stay real.
    const real = new Date();
    const monday = new Date(real);
    monday.setDate(real.getDate() - ((real.getDay() + 6) % 7));
    monday.setHours(4, 0, 0, 0);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(monday);
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    const b1 = await screen.findByRole("region", { name: "B1 Evening — Tue/Thu" });
    await user.selectOptions(
      within(b1).getByLabelText("Class teacher for B1 Evening — Tue/Thu"),
      "Ben",
    );
    const alert = await within(b1).findByRole("alert");
    expect(alert).toHaveTextContent("That would double-book a teacher or a room:");
    expect(alert).toHaveTextContent(/Ben already teaches A2 Evening — Tue\/Thu on Tue, /);
    expect(within(b1).getByLabelText("Class teacher for B1 Evening — Tue/Thu")).toHaveDisplayValue(
      "Tara",
    );
  });

  it("make-up board: every absence listed; staff book An into A2 Evening's Unit 5", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    const board = await screen.findByRole("region", { name: "Make-up lessons" });
    expect(await within(board).findByTestId("makeup-counts")).toHaveTextContent(
      "0 overdue · 3 to arrange · 0 booked · 0 waiting for teacher · 0 made up",
    );
    await user.click(
      within(board).getByRole("button", { name: "Find a session · An P. · A2 — Unit 5" }),
    );
    const pick = await within(board).findByLabelText("Make-up session for An P. · A2 — Unit 5");
    await user.selectOptions(pick, within(pick as HTMLElement).getAllByRole("option")[1]);
    await user.click(within(board).getByRole("button", { name: "Book" }));
    await waitFor(() =>
      expect(within(board).getByTestId("makeup-counts")).toHaveTextContent(
        "2 to arrange · 1 booked",
      ),
    );
    expect(within(board).getByText(/joins A2 Evening — Tue\/Thu/)).toBeInTheDocument();
  });

  it("is closed to teachers", async () => {
    renderApp("/app/operations", "teacher");
    expect(await screen.findByText(/hidden for the current demo persona/)).toBeInTheDocument();
  });
});
