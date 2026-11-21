// P2 · Center operations page (staff): cancel-with-replacement and substitute, in the UI.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { sessionStore } from "../../lib/adapters/sessionStore";

beforeEach(() => __resetAttendanceForTests());

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

  it("staff reassign a class teacher", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    const b1 = await screen.findByRole("region", { name: "B1 Evening — Tue/Thu" });
    await user.selectOptions(
      within(b1).getByLabelText("Class teacher for B1 Evening — Tue/Thu"),
      "Ben",
    );
    await waitFor(() =>
      expect(
        within(b1).getByLabelText("Class teacher for B1 Evening — Tue/Thu"),
      ).toHaveDisplayValue("Ben"),
    );
  });

  it("is closed to teachers", async () => {
    renderApp("/app/operations", "teacher");
    expect(await screen.findByText(/hidden for the current demo persona/)).toBeInTheDocument();
  });
});
