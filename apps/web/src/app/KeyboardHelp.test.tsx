import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KeyboardHelp } from "./KeyboardHelp";

describe("KeyboardHelp", () => {
  it("opens on '?' and closes on Escape", async () => {
    render(<KeyboardHelp />);
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();

    await userEvent.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull(),
    );
  });

  it("does not open when typing '?' inside a text field", async () => {
    render(
      <>
        <input aria-label="field" />
        <KeyboardHelp />
      </>,
    );
    await userEvent.click(screen.getByLabelText("field"));
    await userEvent.keyboard("?");
    expect(screen.queryByRole("dialog", { name: "Keyboard shortcuts" })).toBeNull();
  });
});
