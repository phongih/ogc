// Decision Engine UI: rules by category, pause / tune + save, events, job status; teacher inbox.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";

beforeEach(() => {
  __resetAttendanceForTests();
  window.localStorage.clear();
});

describe("Decision Engine page", () => {
  it("staff pause a rule, tune a threshold, see events and run the job", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/engine", "staff");
    expect(await screen.findByText("11 rules · 10 active")).toBeInTheDocument();
    for (const c of ["Learning", "Attendance & make-up", "Operations", "Engagement"])
      expect(screen.getByRole("region", { name: c })).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Pause Absent several sessions in a row" }),
    );
    expect(await screen.findByText("11 rules · 9 active")).toBeInTheDocument();

    const t = screen.getByLabelText("Skill below threshold: skill below");
    await user.clear(t);
    await user.type(t, "0");
    await user.click(screen.getByRole("button", { name: "Save Skill below threshold" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Not saved: skill below must be 1–100",
    );
    await user.clear(t);
    await user.type(t, "53");
    await user.click(screen.getByRole("button", { name: "Save Skill below threshold" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save Skill below threshold" })).toBeNull(),
    );

    await user.click(screen.getByRole("tab", { name: "Events" }));
    const events = await screen.findByRole("list", { name: "Engine events" });
    expect(within(events).getAllByText(/Use of English is 52, below 53/).length).toBeGreaterThan(0);
    expect(within(events).queryByText(/Absent from the last/)).toBeNull(); // paused

    await user.click(screen.getByRole("tab", { name: "Job Status" }));
    const status = await screen
      .findByRole("group", { name: "Job status" })
      .catch(() => screen.findByLabelText("Job status"));
    expect(status).toHaveTextContent(/Runs1/);
    await user.click(screen.getByRole("button", { name: "Run now" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Job status")).toHaveTextContent(/Runs2.*0 new events/),
    );
  });

  it("the teacher sees engine notifications on Teaching and can mark them read", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching", "teacher");
    const box = await screen.findByRole("region", { name: "Notifications" });
    expect(within(box).getByText(/Absent several sessions in a row: Huy D\./)).toBeInTheDocument();
    await user.click(within(box).getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Notifications" })).toBeNull());
  });

  it("is closed to teachers", async () => {
    renderApp("/app/operations/engine", "teacher");
    expect(await screen.findByText(/hidden for the current demo persona/)).toBeInTheDocument();
  });
});
