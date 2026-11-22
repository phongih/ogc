// Learning Studio courses UI (owner 22/11): the class teacher proposes, staff link; completion
// only; a link out to Learning Studio. SYNTHETIC.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetStudioLinksForTests } from "../../lib/adapters/mockStudioLinks";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";

beforeEach(() => {
  __resetAttendanceForTests();
  __resetStudioLinksForTests();
  window.localStorage.clear();
});

describe("Learning Studio courses page", () => {
  it("staff: link Tara's proposal; see completion of the linked class; open in Learning Studio", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/courses", "staff");
    const b1 = await screen.findByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    await user.click(within(b1).getByRole("button", { name: "Link · LS-B1-SPEAK" }));
    expect(await within(b1).findByTestId("linked-B1 Evening — Tue/Thu")).toHaveTextContent(
      /B1 Speaking Confidence.*proposed by Tara/,
    );
    const a2 = screen.getByRole("region", { name: "Class A2 Morning — Mon/Wed" });
    expect(within(a2).getByRole("link", { name: /Open in Learning Studio/ })).toHaveAttribute(
      "href",
      expect.stringContaining("LS-A2-EVERYDAY"),
    );
    await user.click(within(a2).getByRole("button", { name: /Show completion/ }));
    const t = await within(a2).findByRole("table", { name: /Completion/ });
    expect(within(t).getAllByRole("row")).toHaveLength(4); // header + 3 learners
  });

  it("teacher: proposes for their own class; a draft course cannot be proposed", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching/courses", "teacher");
    const b1 = await screen.findByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    expect(within(b1).queryByRole("button", { name: /^Link/ })).toBeNull();
    await user.click(within(b1).getByRole("button", { name: /Propose a course/ }));
    const results = await within(b1).findByRole("list", { name: /Learning Studio results/ });
    expect(await within(results).findAllByText(/cannot be linked/)).toHaveLength(2); // draft + archived
    await user.click(within(results).getByRole("button", { name: "Propose LS-IELTS-W1" }));
    expect(await within(b1).findByTestId("proposal-LS-IELTS-W1")).toHaveTextContent(
      /waiting for center staff/,
    );
  });
});
