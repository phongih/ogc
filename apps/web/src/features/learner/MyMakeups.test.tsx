// P2 · slice 4 in the UI: learner submits self-study, guardian sees it read-only, teacher confirms.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests, mockAttendance } from "../../lib/adapters/mockAttendance";
import { mockMakeup } from "../../lib/adapters/mockMakeup";
import { seedSessions } from "../../fixtures/attendance";
import { classes } from "../../fixtures/teaching";
import { LEARNER_LINH } from "../../fixtures/personas";

const unit6 = () =>
  seedSessions.find((s) => s.classId === classes[0].id && s.title === "A2 — Unit 6")!.id;

beforeEach(async () => {
  __resetAttendanceForTests();
  const view = (await mockAttendance.getSessionAttendance("demo-teacher", unit6()))!;
  await mockAttendance.recordAttendance("demo-teacher", unit6(), {
    marks: view.rows.map((r) => ({
      learnerId: r.learnerId,
      mark: r.learnerId === LEARNER_LINH ? ("absent" as const) : ("present" as const),
    })),
  });
  await mockMakeup.assignSelfStudy("demo-staff", `${unit6()}::${LEARNER_LINH}`);
});

describe("Make-up lessons — learner, guardian, teacher", () => {
  it("learner sees the missed unit and sends her self-study to the teacher", async () => {
    const user = userEvent.setup();
    renderApp("/app/learning", "learner");
    const box = await screen.findByRole("region", { name: "Make-up lessons" });
    expect(within(box).getByText("A2 — Unit 6")).toBeInTheDocument();
    expect(within(box).getByText("self-study · Tara confirms")).toBeInTheDocument();
    const send = within(box).getByRole("button", { name: "Send to my teacher" });
    expect(send).toBeDisabled();
    await user.type(within(box).getByRole("textbox"), "Read Unit 6 and did the exercises");
    await user.click(send);
    expect(
      await within(box).findByText("self-study · submitted, waiting for Tara"),
    ).toBeInTheDocument();
    expect(within(box).getByText("Waiting for teacher")).toBeInTheDocument();
  });

  it("guardian sees it, read-only", async () => {
    renderApp("/app/guardian", "guardian");
    const box = await screen.findByRole("region", { name: "Make-up lessons" });
    expect(within(box).getByText("A2 — Unit 6")).toBeInTheDocument();
    expect(within(box).queryByRole("button")).toBeNull();
  });

  it("teacher confirms the submitted self-study", async () => {
    await mockMakeup.submitSelfStudy(
      "demo-learner",
      `${unit6()}::${LEARNER_LINH}`,
      "Read Unit 6 and did the exercises",
    );
    const user = userEvent.setup();
    renderApp("/app/teaching", "teacher");
    const box = await screen.findByRole("region", { name: "Self-study to confirm" });
    expect(within(box).getByText(/Read Unit 6 and did the exercises/)).toBeInTheDocument();
    await user.click(within(box).getByRole("button", { name: "Confirm make-up · Linh N." }));
    expect(
      await screen.findByText("Every session that has started is marked."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Self-study to confirm" })).toBeNull(),
    );
    expect((await mockMakeup.listMine("demo-learner"))[0].status).toBe("done");
  });
});
