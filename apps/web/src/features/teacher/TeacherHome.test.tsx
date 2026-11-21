import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
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

    expect(
      screen.getAllByRole("link", { name: /learner overview/i }).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole("link", { name: /lesson planning/i }).length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("summarizes teaching with stat tiles (classes + total learners)", async () => {
    renderApp("/app/teaching", "teacher");
    await waitFor(() => expect(screen.getByText("Classes")).toBeInTheDocument());

    // 2 synthetic classes with 12 + 9 = 21 learners.
    expect(
      within(screen.getByText("Classes").closest("div") as HTMLElement).getByText("2"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByText("Learners").closest("div") as HTMLElement).getByText("21"),
    ).toBeInTheDocument();
  });

  it("sessions show in center time with the class's own weekday and hour", async () => {
    renderApp("/app/teaching", "teacher");
    expect(await screen.findByText(/^(Mon|Wed), \d{2}\/\d{2}\/\d{4}, 09:00$/)).toBeInTheDocument(); // A2 — Unit 7
    expect(screen.getByText(/^(Tue|Thu), \d{2}\/\d{2}\/\d{4}, 18:00$/)).toBeInTheDocument(); // B1 — Unit 3
  });
});
