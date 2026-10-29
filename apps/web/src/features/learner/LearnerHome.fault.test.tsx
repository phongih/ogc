import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { clearAllFaults, setFault } from "../../lib/adapters/faults";

afterEach(() => clearAllFaults());

describe("error recovery (fault injection)", () => {
  it("shows an error state on failure, then recovers on retry once the fault clears", async () => {
    setFault("learner.getDashboard", "error");
    renderApp("/app/learning", "learner");

    // Error UI is shown (fail path).
    await waitFor(() => expect(screen.getByText(/Could not load your learning/i)).toBeInTheDocument());

    // Clear the fault and retry → recovers to real content (no network involved).
    clearAllFaults();
    await userEvent.click(screen.getByRole("button", { name: /Try again/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "My Learning" })).toBeInTheDocument());
  });

  it("renders the loading state before data resolves", async () => {
    setFault("learner.getDashboard", "timeout");
    renderApp("/app/learning", "learner");
    // The spinner's status role is present while the (ultimately failing) call is in flight.
    expect(screen.getByRole("status")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Could not load your learning/i)).toBeInTheDocument());
  });
});
