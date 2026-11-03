import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/harness";

describe("TeacherHome", () => {
  it("lists the teacher's assigned classes and upcoming sessions", async () => {
    renderApp("/app/teaching", "teacher");

    await waitFor(() => expect(screen.getByText("A2 Morning — Mon/Wed")).toBeInTheDocument());
    expect(screen.getByText("B1 Evening — Tue/Thu")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assigned classes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Upcoming sessions" })).toBeInTheDocument();
    expect(screen.getByText("A2 — Unit 7")).toBeInTheDocument();
  });

  it("links each class to its learner overview and lesson planning", async () => {
    renderApp("/app/teaching", "teacher");
    await waitFor(() => expect(screen.getByText("A2 Morning — Mon/Wed")).toBeInTheDocument());

    expect(screen.getAllByRole("link", { name: /learner overview/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: /lesson planning/i }).length).toBeGreaterThanOrEqual(1);
  });
});
