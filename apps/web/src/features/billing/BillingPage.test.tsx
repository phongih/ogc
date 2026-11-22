// Billing UI (owner 22/11): an Org Admin approves a staff proposal; staff record a payment; the
// guardian sees the invoice read-only; a minor sees a note. SYNTHETIC — nothing is charged.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetBillingForTests } from "../../lib/adapters/mockBilling";
import { __resetGrowthForTests } from "../../lib/adapters/mockGrowth";

beforeEach(() => {
  __resetGrowthForTests();
  __resetBillingForTests();
  window.localStorage.clear();
});

describe("Billing page", () => {
  it("an Org Admin approves the pending materials fee proposed by staff", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/billing", "admin");
    const approve = await screen.findByRole("button", {
      name: "Approve · ENG-A2 materials Term 2",
    });
    await user.click(approve);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Approve · ENG-A2 materials/ })).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Retire · ENG-A2 materials Term 2" }),
    ).toBeInTheDocument();
  });

  it("staff cannot approve; they record a payment and get a (mock) receipt", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/billing", "staff");
    expect(await screen.findByText(/ENG-A2 · Materials · Term 2/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    await user.click(screen.getByRole("tab", { name: "Invoices" }));
    const no = (await screen.findByText(/^INV-\d{4}-0004$/)).textContent!; // year follows the clock
    const card = screen.getByText(no).closest("li")!;
    expect(within(card).getByText("Huy D.", { exact: false })).toBeInTheDocument();
    await user.type(within(card).getByLabelText(`Amount for ${no}`), "1000000");
    await user.click(within(card).getByRole("button", { name: `Record payment · ${no}` }));
    expect(await within(card).findByRole("status")).toHaveTextContent(/Receipt RC-2026-\d{4}/);
  });

  it("a guardian sees their child's invoice; a learner under 18 sees a note", async () => {
    renderApp("/app/tuition", "guardian");
    expect(await screen.findByText(/^INV-\d{4}-0001$/)).toBeInTheDocument();
    expect(screen.getByTestId("to-pay")).toHaveTextContent("0");
  });
  it("a minor learner has no invoices of their own", async () => {
    renderApp("/app/tuition", "learner");
    expect(await screen.findByText("Tuition is handled by your guardian")).toBeInTheDocument();
  });
});
