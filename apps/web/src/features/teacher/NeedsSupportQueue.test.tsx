// P1 · Learners needing support — teacher UI (evidence labels + assign through AUTH-026).
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { mockPractice } from "../../lib/adapters/mockPractice";

describe("Learners needing support (teacher home)", () => {
  it("baseline lists placement-only flags, labelled as such", async () => {
    renderApp("/app/teaching", "teacher");
    expect(
      await screen.findByRole("heading", { name: "Learners needing support (3)" }),
    ).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Learners needing support" });
    expect(within(list).getAllByText("Placement only")).toHaveLength(3);
    expect(within(list).getByText(/Speaking is 55 \(below 60\)/)).toBeInTheDocument();
  });

  it("practice evidence moves a learner to the top; the teacher assigns the suggested activity", async () => {
    const user = userEvent.setup();
    await mockPractice.submitPractice("demo-learner", "ACT-A2-3", {
      attemptId: "SUP-UI-1",
      responses: [
        { itemId: "A2-3-Q1", optionId: "a" },
        { itemId: "A2-3-Q2", optionId: "b" },
      ],
    });
    renderApp("/app/teaching", "teacher");
    const list = await screen.findByRole("list", { name: "Learners needing support" });
    const first = within(list).getAllByRole("listitem")[0];
    expect(first).toHaveTextContent("Linh N.");
    expect(within(first).getByText("Evidence from practice")).toBeInTheDocument();
    expect(
      within(first).getByText(/Use of English dropped 6 to 59 after the latest practice/),
    ).toBeInTheDocument();

    await user.click(within(first).getByRole("button", { name: "Assign to Linh N." }));
    const reason = within(first).getByRole("textbox");
    expect(reason).toHaveValue("Targeted practice for Use of English");
    await user.click(within(first).getByRole("button", { name: "Assign “Quiz: Opinion phrases”" }));
    await waitFor(() =>
      expect(screen.getByTestId("assigned-00000000-0000-4000-8000-00000000L001")).toHaveTextContent(
        "Assigned next: Quiz: Opinion phrases",
      ),
    );
  });

  it("is not on a learner's screen (Teaching is not in their workspace)", async () => {
    renderApp("/app/teaching", "learner");
    expect(await screen.findByText("Not available for this persona")).toBeInTheDocument();
  });
});
