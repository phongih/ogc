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

  it("shows a read-only per-course progress breakdown for the linked learner", async () => {
    renderApp("/app/guardian", "guardian");
    await waitFor(() => expect(screen.getByText("Linh N.")).toBeInTheDocument());

    expect(screen.getByRole("heading", { name: "By course" })).toBeInTheDocument();
    // Overall ring ("Linh N. progress") plus per-course bars ("<course> progress"),
    // which load asynchronously through the authorization-checked ProgressViewPort.
    await waitFor(() =>
      expect(screen.getAllByRole("progressbar", { name: /progress$/i }).length).toBeGreaterThanOrEqual(2),
    );
    // Still read-only: no control to mutate the link or verify it.
    expect(screen.queryByRole("button", { name: /add learner|verify|edit link/i })).toBeNull();
  });
});
