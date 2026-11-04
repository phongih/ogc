import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBoundary } from "./ErrorBoundary";

let willThrow = true;
function Flaky() {
  if (willThrow) throw new Error("boom");
  return <div>recovered content</div>;
}

describe("ErrorBoundary", () => {
  it("shows a recovery fallback on a render error and recovers on Try again", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    willThrow = true;
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);

    // Fix the underlying cause, then recover.
    willThrow = false;
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("recovered content")).toBeInTheDocument());

    spy.mockRestore();
  });
});
