// Regression (seen live 21/11): after submitting a practice, the result page showed the
// PRE-submit next step (the activity just practised) because the learner-intelligence
// queries (li-*) were not invalidated. The next step must reflect the new evidence.
import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../../test/harness";

describe("practice result — next step is fresh", () => {
  it("after the quiz, 'Your next step' is the unlocked speaking activity, not the quiz", async () => {
    const user = userEvent.setup();
    renderApp("/app/learning/practice/ACT-A2-3", "learner");
    await screen.findByRole("heading", { name: "At the market" });
    // the pre-submit next step is this very quiz
    for (const t of [
      "How much are the apples?",
      "No thanks, I'm fine.",
      "Can I have half a kilo of tomatoes, please?",
      "Can I pay by card?",
    ])
      await user.click(screen.getByLabelText(t));
    await user.click(screen.getByRole("button", { name: "Submit answers" }));
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .map((e) => e.textContent)
          .join(" "),
      ).toMatch(/You scored 100%/),
    );
    await waitFor(() =>
      expect(screen.getByTestId("practice-next-reason")).toHaveTextContent(
        "Speaking: Describe your weekend",
      ),
    );
  });
});
