import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import axe from "axe-core";
import { renderApp } from "./harness";

// Automated accessibility checks (S3-E). Fail on serious/critical violations only.
// color-contrast is disabled: jsdom has no layout engine, so it cannot be evaluated here.
async function runAxe(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
}

const views: Array<{ name: string; path: string; role: Parameters<typeof renderApp>[1]; ready: RegExp }> = [
  { name: "catalog", path: "/app/catalog", role: "learner", ready: /catalog/i },
  { name: "AI tutor", path: "/app/tutor", role: "learner", ready: /AI Tutor/i },
  { name: "guardian workspace", path: "/app/guardian", role: "guardian", ready: /guardian workspace/i },
];

describe("accessibility (axe-core)", () => {
  it.each(views)("$name has no serious/critical a11y violations", async ({ path, role, ready }) => {
    const { container, findAllByText } = renderApp(path, role);
    await waitFor(() => expect(container.querySelector("h1")).toBeTruthy());
    await findAllByText(ready);
    const violations = await runAxe(container);
    expect(violations.map((v) => v.id)).toEqual([]);
  });
});
