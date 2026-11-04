import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeToggle } from "./ThemeToggle";

afterEach(() => {
  delete document.documentElement.dataset.theme;
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("ThemeToggle", () => {
  it("cycles System → Light → Dark → System, applying data-theme and persisting", async () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /Theme: System/i })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBeUndefined();

    await userEvent.click(screen.getByRole("button", { name: /Theme: System/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("ogc-theme")).toBe("light");

    await userEvent.click(screen.getByRole("button", { name: /Theme: Light/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");

    await userEvent.click(screen.getByRole("button", { name: /Theme: Dark/i }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("ogc-theme")).toBe("system");
  });

  it("is activatable from the keyboard (Enter)", async () => {
    render(<ThemeToggle />);
    screen.getByRole("button", { name: /Theme:/i }).focus();
    await userEvent.keyboard("{Enter}");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("restores the persisted theme on mount", async () => {
    localStorage.setItem("ogc-theme", "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /Theme: Dark/i })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
