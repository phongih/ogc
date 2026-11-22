// Current Students UI (owner 22/11): counts per level, evidence on every card, suggestions and
// tuition (staff only) behind a toggle; teachers see their own learners without tuition.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { __resetBillingForTests } from "../../lib/adapters/mockBilling";

beforeEach(() => {
  __resetAttendanceForTests();
  __resetBillingForTests();
  window.localStorage.clear();
});

describe("Current students page", () => {
  it("staff: levels with evidence; tuition is information only", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/students", "staff");
    expect(await screen.findByTestId("count-support")).toHaveTextContent("1");
    expect(screen.getByTestId("care-Huy D.")).toHaveTextContent("Needs support");
    const huy = screen.getByRole("region", { name: "Student Huy D." });
    expect(
      within(huy).getByText("Absent from the last 2 marked sessions (attendance)"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("care-Vy H.")).toHaveTextContent("OK");
    await user.click(screen.getByRole("button", { name: /suggestions and tuition · Vy H\./ }));
    expect(screen.getByTestId("tuition-Vy H.")).toHaveTextContent(/overdue/);
    await user.selectOptions(screen.getByLabelText("Care level"), "watch");
    expect(screen.queryByRole("region", { name: "Student Huy D." })).toBeNull();
    expect(screen.getByRole("region", { name: "Student An P." })).toBeInTheDocument();
  });

  it("a teacher sees own learners, no tuition", async () => {
    renderApp("/app/teaching/students", "teacher");
    expect(await screen.findByRole("region", { name: "Student Huy D." })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Student Vy H." })).toBeNull(); // Ben's class
    expect(screen.queryByText(/and tuition/)).toBeNull();
  });
});
