// P2 · take attendance in the UI, end to end within one page session (no reload: the mock store
// lives in memory), and see the result in the class summary and the support queue.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { classes } from "../../fixtures/teaching";

beforeEach(() => __resetAttendanceForTests());

describe("Take attendance", () => {
  it("teacher marks the started session; An's second absence reaches the support queue", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching", "teacher");
    expect(
      await screen.findByRole("heading", { name: "Attendance to take (1)" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /^Take attendance · A2 — Unit 6$/ }));

    expect(
      await screen.findByRole("heading", { name: "Attendance · A2 — Unit 6" }),
    ).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save attendance" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Mark all present" }));
    await user.click(
      within(screen.getByRole("group", { name: "Attendance for An P." })).getByLabelText("Absent"),
    );
    expect(save).toBeEnabled();
    await user.click(save);
    expect(await screen.findByText("Attendance saved.")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "← Back to the class" }));
    expect(await screen.findByText("last 2 in a row")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit attendance · A2 — Unit 6" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "← Back to teaching" }));
    expect(
      await screen.findByText("Every session that has started is marked."),
    ).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Learners needing support" });
    const anFlags = await within(list).findByRole("list", { name: "Why An P. is flagged" });
    expect(within(anFlags).getByText(/Absent from the last 2 sessions/)).toBeInTheDocument();
  });

  it("editing a marked session starts from the recorded marks", async () => {
    renderApp(`/app/teaching/classes/${classes[0].id}`, "teacher");
    const links = await screen.findAllByRole("link", { name: /^Edit attendance · / });
    await userEvent.setup().click(links[0]); // newest marked: An was absent
    const an = await screen.findByRole("group", { name: "Attendance for An P." });
    expect(within(an).getByLabelText("Absent")).toBeChecked();
    expect(screen.getByRole("button", { name: "Save attendance" })).toBeEnabled();
    expect(screen.getByText("Marked — saving again replaces these marks.")).toBeInTheDocument();
  });

  it("an upcoming session cannot be marked yet", async () => {
    renderApp(`/app/teaching/classes/${classes[0].id}/sessions/SES-001`, "teacher");
    expect(
      await screen.findByText(/has not started yet — attendance opens when it starts/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save attendance" })).toBeNull();
  });

  it("other roles get no session", async () => {
    renderApp(`/app/teaching/classes/${classes[0].id}/sessions/SES-001`, "learner");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Save attendance" })).toBeNull(),
    );
  });
});
