// Forecast UI (owner 22/11): four horizons vs last year; a staff member whose access policy has no
// forecast rule is told so (not "for center staff"). SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { __attachForTests } from "../../lib/integration/mockIiosPolicy";
import { __resetForecastForTests } from "../../lib/adapters/mockForecast";

const SAM_P = "iios-principal-staff-1";
beforeEach(() => {
  __resetAttendanceForTests();
  __resetForecastForTests();
  window.localStorage.clear();
});
afterEach(() => __attachForTests(SAM_P, null));

describe("Forecast page", () => {
  it("staff see four horizons compared with last year", async () => {
    renderApp("/app/operations/forecast", "staff");
    expect(await screen.findByRole("table", { name: "Forecast by horizon" })).toBeInTheDocument();
    expect(screen.getByTestId("cell-enrolments-12")).toHaveTextContent(/last year/);
  });

  it("a policy without a forecast rule: says so and names the policy", async () => {
    __attachForTests(SAM_P, "policy-own-classes");
    renderApp("/app/operations/forecast", "staff");
    expect(
      await screen.findByText("Your access policy does not include the forecast"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/"Teacher — own classes only" has no forecast rule/),
    ).toBeInTheDocument();
  });

  it("scenarios: three side by side; trying a figure updates them; staff save", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/forecast", "staff");
    const table = await screen.findByRole("table", { name: "Scenarios compared" });
    for (const k of ["Conservative", "Base", "Optimistic"])
      expect(within(table).getByRole("rowheader", { name: k })).toBeInTheDocument();
    const before = screen.getByTestId("scenario-base").textContent;
    const fixed = screen.getByLabelText(/Fixed costs \/ month/);
    await user.clear(fixed);
    await user.type(fixed, "20000000");
    expect(screen.getByTestId("scenario-base").textContent).not.toBe(before);
    await user.click(screen.getByRole("button", { name: "Save figures" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
  });

  it("D1 front desk: no scenarios — they use organization-wide costs", async () => {
    __attachForTests(SAM_P, "policy-front-desk-d1");
    renderApp("/app/operations/forecast", "staff");
    expect(await screen.findByTestId("no-scenarios")).toBeInTheDocument();
  });
});
