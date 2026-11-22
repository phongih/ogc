import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import axe from "axe-core";
import { renderApp } from "./harness";
import { courses } from "../fixtures/catalog";
import { classes } from "../fixtures/teaching";
import { organizations, centers } from "../fixtures/directory";

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
  { name: "course learning", path: `/app/learning/courses/${courses[0].id}`, role: "learner", ready: /Learning activities/i },
  { name: "teacher class detail", path: `/app/teaching/classes/${classes[0].id}`, role: "teacher", ready: /Learner overview/i },
  // Views carrying the new progress visualizations and directory pages.
  { name: "learner home", path: "/app/learning", role: "learner", ready: /My Learning/i },
  { name: "teacher home", path: "/app/teaching", role: "teacher", ready: /Teaching/i },
  { name: "workforce", path: "/app/operations/workforce", role: "staff", ready: /Utilization/i },
  { name: "forecast", path: "/app/operations/forecast", role: "staff", ready: /Four horizons/i },
  { name: "partner commissions", path: "/app/operations/partners", role: "staff", ready: /Decision signals/i },
  { name: "current students", path: "/app/operations/students", role: "staff", ready: /Needs support/i },
  { name: "admissions", path: "/app/operations/admissions", role: "staff", ready: /Lead → enrolled/i },
  { name: "billing", path: "/app/operations/billing", role: "staff", ready: /Billing & payments/i },
  { name: "tuition", path: "/app/tuition", role: "guardian", ready: /Referral credit waiting/i },
  { name: "organizations", path: "/app/orgs", role: "staff", ready: /Organizations/i },
  { name: "organization detail", path: `/app/orgs/${organizations[0].id}`, role: "staff", ready: /Nova Learning Group/i },
  { name: "center detail", path: `/app/centers/${centers[0].id}`, role: "staff", ready: /District 1/i },
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
