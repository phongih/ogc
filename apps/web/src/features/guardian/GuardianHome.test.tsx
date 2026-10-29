import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/harness";

describe("GuardianHome", () => {
  it("shows linked learners with progress and consent for a guardian", async () => {
    renderApp("/app/guardian", "guardian");
    await waitFor(() => expect(screen.getByText("Linh N.")).toBeInTheDocument());
    expect(screen.getByRole("progressbar", { name: /Linh N\. progress/i })).toBeInTheDocument();
    expect(screen.getByText(/consent on file/i)).toBeInTheDocument();
  });

  // D-14: the UI must not offer any self-verification / add-link control.
  it("states that guardians cannot self-verify a learner link (D-14)", async () => {
    renderApp("/app/guardian", "guardian");
    await waitFor(() => expect(screen.getByText(/cannot add or verify a learner link/i)).toBeInTheDocument());
    // No control to add or verify a link exists.
    expect(screen.queryByRole("button", { name: /add learner|verify/i })).toBeNull();
  });
});
