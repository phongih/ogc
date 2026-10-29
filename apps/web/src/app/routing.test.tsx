import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../test/harness";

describe("application routing (deep links + fail-closed nav + a11y smoke)", () => {
  it("deep-links to the course catalog for a learner", async () => {
    renderApp("/app/catalog", "learner");
    await waitFor(() => expect(screen.getByText("Course catalog")).toBeInTheDocument());
    // a11y + non-production smoke
    expect(document.querySelector("main#main")).toBeTruthy();
    expect(screen.getByText(/NON-PRODUCTION/)).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  });

  it("deep-links to a specific course detail", async () => {
    renderApp("/app/catalog/00000000-0000-4000-8000-000000000e03", "learner");
    await waitFor(() => expect(screen.getByText("IELTS Foundation B2")).toBeInTheDocument());
    expect(screen.getByText("Learning objectives")).toBeInTheDocument();
  });

  it("lands a teacher on their teaching workspace", async () => {
    renderApp("/app", "teacher");
    await waitFor(() => expect(screen.getByText("Assigned classes")).toBeInTheDocument());
  });

  it("fail-closes an unauthorized section for the persona (learner → directory)", async () => {
    renderApp("/app/orgs", "learner");
    await waitFor(() =>
      expect(screen.getByText("Not available for this persona")).toBeInTheDocument(),
    );
    // the directory content must not render
    expect(screen.queryByText("Organizations")).not.toBeInTheDocument();
  });

  it("shows the learner dashboard with progress indicators", async () => {
    renderApp("/app/learning", "learner");
    await waitFor(() => expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0));
  });
});
