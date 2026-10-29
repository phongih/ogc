import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { renderApp } from "../../test/harness";

// The mobile toggle is always in the DOM (hidden via CSS at ≥sm; jsdom has no media
// queries, so behavior is testable regardless of viewport).
describe("mobile navigation drawer (a11y behavior)", () => {
  it("opens from the toggle, moves focus into the drawer, and exposes aria state", async () => {
    renderApp("/app/catalog", "learner");
    const toggle = await waitFor(() => screen.getByRole("button", { name: "Open menu" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
    // Focus moved to the first link inside the drawer.
    await waitFor(() => expect(within(dialog).getByRole("link", { name: "My Learning" })).toHaveFocus());

    // The open drawer has no serious/critical accessibility violations.
    const results = await axe.run(document.body, { rules: { "color-contrast": { enabled: false } } });
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  it("closes on Escape and restores focus to the toggle", async () => {
    renderApp("/app/catalog", "learner");
    const toggle = await waitFor(() => screen.getByRole("button", { name: "Open menu" }));
    await userEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
    expect(screen.getByRole("button", { name: "Open menu" })).toHaveFocus();
  });

  it("traps Tab within the drawer (containment) — forward wraps last → first", async () => {
    renderApp("/app/catalog", "learner");
    await userEvent.click(await waitFor(() => screen.getByRole("button", { name: "Open menu" })));
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    const links = within(dialog).getAllByRole("link");
    const first = links[0];
    const last = links[links.length - 1];
    last.focus();
    expect(last).toHaveFocus();
    await userEvent.tab(); // from last → wraps to first (trapped inside the drawer)
    expect(first).toHaveFocus();
  });

  it("traps Shift+Tab within the drawer — backward wraps first → last", async () => {
    renderApp("/app/catalog", "learner");
    await userEvent.click(await waitFor(() => screen.getByRole("button", { name: "Open menu" })));
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    const links = within(dialog).getAllByRole("link");
    links[0].focus();
    await userEvent.tab({ shift: true });
    expect(links[links.length - 1]).toHaveFocus();
  });

  it("closes when a navigation link is selected", async () => {
    renderApp("/app/catalog", "learner");
    await userEvent.click(await waitFor(() => screen.getByRole("button", { name: "Open menu" })));
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    await userEvent.click(within(dialog).getByRole("link", { name: "AI Tutor" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
    // Route changed to the tutor view.
    await waitFor(() => expect(screen.getByRole("heading", { name: "AI Tutor" })).toBeInTheDocument());
  });
});
