// Partner Commissions UI (owner 22/11): signals only suggest; refer from Admissions ranked by fit
// for the learner; staff record, the Org Admin approves. SYNTHETIC.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetPartnersForTests } from "../../lib/adapters/mockPartners";
import { __resetAdmissionsForTests } from "../../lib/adapters/mockAdmissions";

beforeEach(() => {
  __resetAdmissionsForTests();
  __resetPartnersForTests();
  window.localStorage.clear();
});

describe("Partner commissions page", () => {
  it("reconciliation: signals with evidence; dismissing needs a reason and is one fewer", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/partners", "staff");
    const heading = await screen.findByRole("heading", { name: /Decision signals/ });
    const count = () => Number(/\((\d+)\)/.exec(heading.textContent ?? "")![1]);
    const before = count();
    expect(before).toBeGreaterThanOrEqual(4);
    const overdue = screen.getByTestId("signal-overdue_settlement");
    await user.click(within(overdue).getByRole("button", { name: "Dismiss" }));
    expect(await within(overdue).findByRole("alert")).toHaveTextContent(/say why/);
    await user.type(within(overdue).getByRole("textbox"), "paid, receipt pending");
    await user.click(within(overdue).getByRole("button", { name: "Dismiss" }));
    await screen.findByText(/overdue settlement · .* — dismissed: paid, receipt pending/i);
    expect(count()).toBe(before - 1);
  });

  it("ledger: staff record the 4th enrolment of the month at tier 2", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/partners", "staff");
    await user.click(await screen.findByRole("tab", { name: "Ledger" }));
    await user.click(
      await screen.findByRole("button", { name: "Partner confirmed enrolment · Mai L." }),
    );
    expect(await screen.findByText(/rule v1, tier 2 · 2\.000\.000 ₫/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull(); // staff do not approve
  });

  it("admissions: refer to partner lists partners by fit, then closes the lead", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/admissions", "staff");
    await user.click(await screen.findByRole("tab", { name: "Pipeline" }));
    await user.click(await screen.findByRole("button", { name: "Open Duc A." }));
    await user.click(await screen.findByRole("button", { name: "Refer to partner · Duc A." }));
    const list = await screen.findByRole("list", { name: "Partners for Duc A." });
    const items = await within(list).findAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/Hanoi Bridge.*near the learner's center/);
    expect(items[items.length - 1]).toHaveTextContent(/does not teach ENG-A2/);
    await user.click(within(list).getByRole("button", { name: /Refer to Hanoi Bridge/ }));
    expect(
      await screen.findByText("Lost: Referred to partner: Hanoi Bridge English — Dong Da"),
    ).toBeInTheDocument();
  });
});
