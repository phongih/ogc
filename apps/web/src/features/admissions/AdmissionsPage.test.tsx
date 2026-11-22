// Admissions UI (owner 22/11): dashboard rates with numerator / denominator; a lead is opened,
// assigned and moved; a new lead with a phone number is refused. SYNTHETIC.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetAdmissionsForTests } from "../../lib/adapters/mockAdmissions";
import { __resetGrowthForTests } from "../../lib/adapters/mockGrowth";

beforeEach(() => {
  __resetGrowthForTests();
  __resetAdmissionsForTests();
  window.localStorage.clear();
});

describe("Admissions page", () => {
  it("dashboard rates show what they are counted from", async () => {
    renderApp("/app/operations/admissions", "staff");
    expect(await screen.findByTestId("lead-to-enrolled")).toHaveTextContent("14.3%");
    expect(screen.getByText("2 of 14 leads")).toBeInTheDocument();
    const funnel = screen.getByRole("table", { name: "Funnel" });
    expect(within(funnel).getByText("12 of 14")).toBeInTheDocument();
  });

  it("staff open a lead, see why it scored, assign it and log a call", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/admissions", "staff");
    await user.click(await screen.findByRole("tab", { name: "Pipeline" }));
    await user.click(await screen.findByRole("button", { name: "Open Hoa P." }));
    const panel = await screen.findByRole("region", { name: "Lead Hoa P." });
    expect(within(panel).getByRole("table", { name: "Score of Hoa P." })).toHaveTextContent(
      "Came from a walk-in",
    );
    await within(panel).findByRole("option", { name: "Sam (Org Staff)" });
    await user.selectOptions(
      within(panel).getByLabelText("Counselor for Hoa P."),
      "Sam (Org Staff)",
    );
    await user.click(within(panel).getByRole("button", { name: "Assign · Hoa P." }));
    await waitFor(() =>
      expect(
        within(screen.getByRole("region", { name: "Assigned" })).getByText("Hoa P."),
      ).toBeInTheDocument(),
    );
    const panel2 = screen.getByRole("region", { name: "Lead Hoa P." });
    await user.type(
      within(panel2).getByLabelText("Activity for Hoa P."),
      "Called, wants a trial lesson",
    );
    await user.click(within(panel2).getByRole("button", { name: "Log · Hoa P." }));
    expect(await screen.findByText("Called, wants a trial lesson")).toBeInTheDocument();
  });

  it("a new lead with a phone number is refused; a synthetic one is added", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/admissions", "staff");
    await user.click(await screen.findByRole("tab", { name: "Pipeline" }));
    await user.click(await screen.findByRole("button", { name: "+ New lead" }));
    await user.type(screen.getByLabelText("Lead name"), "Anh 0912345678");
    await user.click(screen.getByRole("button", { name: "Add lead" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/no phone numbers/);
    await user.clear(screen.getByLabelText("Lead name"));
    await user.type(screen.getByLabelText("Lead name"), "Anh Q.");
    await user.click(screen.getByRole("button", { name: "Add lead" }));
    expect(await screen.findByRole("button", { name: "Open Anh Q." })).toBeInTheDocument();
  });
});
