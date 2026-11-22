// Forecast UI (owner 22/11): four horizons vs last year; a staff member whose access policy has no
// forecast rule is told so (not "for center staff"). SYNTHETIC.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { __attachForTests } from "../../lib/integration/mockIiosPolicy";

const SAM_P = "iios-principal-staff-1";
beforeEach(() => {
  __resetAttendanceForTests();
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
});
