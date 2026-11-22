// Workforce UI (owner 22/11): bands per teacher, target edit; "Who has room?" next to the class
// teacher choice lists candidates with load before → after and never assigns. SYNTHETIC.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { __resetWorkforceForTests } from "../../lib/adapters/mockWorkforce";

beforeEach(() => {
  __resetAttendanceForTests();
  __resetWorkforceForTests();
  window.localStorage.clear();
});

describe("Workforce page", () => {
  it("shows each teacher against their target; staff change a target", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/workforce", "staff");
    expect(await screen.findByTestId("load-Tara")).toHaveTextContent("3 of 2.5 h · 120%");
    expect(screen.getByTestId("band-over")).toHaveTextContent("1");
    const tara = screen.getByRole("region", { name: "Load of Tara" });
    await user.click(within(tara).getByRole("button", { name: "Details · Tara" }));
    expect(within(tara).getByText(/A2 Morning — Mon\/Wed · class teacher/)).toBeInTheDocument();
    const h = within(tara).getByLabelText("Target hours of Tara");
    await user.clear(h);
    await user.type(h, "6");
    await user.click(within(tara).getByRole("button", { name: "Save target · Tara" }));
    expect(await screen.findByText("3 of 6 h · 50%")).toBeInTheDocument();
  });

  it("center operations: 'Who has room?' suggests, assigns nothing", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    await user.click(
      await screen.findByRole("button", { name: "Who has room? · A2 Morning — Mon/Wed" }),
    );
    const list = await screen.findByRole("list", {
      name: "Load suggestions for A2 Morning — Mon/Wed",
    });
    expect(within(list).getByText(/Would go over target/)).toBeInTheDocument(); // Ben
    expect(
      within(list).getByText("Suggestions only — choose the teacher yourself."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Class teacher for A2 Morning — Mon/Wed")).toHaveDisplayValue(
      "Tara",
    );
  });
});
