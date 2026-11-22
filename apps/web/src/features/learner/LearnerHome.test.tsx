import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "../../test/harness";

// Per-course bars expose aria-label "Progress N%"; the overall ring is labelled distinctly.
const perCourseBars = () => screen.getAllByRole("progressbar", { name: /^Progress \d+%$/ });

describe("LearnerHome progress visualization", () => {
  it("shows an overall ring equal to the equal-weight mean of the enrolled courses", async () => {
    renderApp("/app/learning", "learner");
    await waitFor(() => expect(screen.getByRole("heading", { name: "My Learning" })).toBeInTheDocument());

    const bars = perCourseBars();
    expect(bars.length).toBeGreaterThanOrEqual(1);
    const vals = bars.map((b) => Number(b.getAttribute("aria-valuenow")));
    const expected = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

    const ring = screen.getByRole("progressbar", { name: "Overall learning progress" });
    expect(Number(ring.getAttribute("aria-valuenow"))).toBe(expected);
    expect(screen.getByText(/equal-weight average/i)).toBeInTheDocument();
  });

  it("renders a progress bar and resume link for each enrolled course", async () => {
    renderApp("/app/learning", "learner");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Enrolled courses" })).toBeInTheDocument());

    const bars = perCourseBars();
    const resumeLinks = screen.getAllByRole("link", { name: /resume learning/i });
    expect(bars.length).toBeGreaterThanOrEqual(1);
    expect(resumeLinks.length).toBe(bars.length);
  });

  // Gamification (22/11): derived from evidence only — the old fixed "5-day streak / Quiz ace"
  // card is gone. Linh's seeded completions are weeks old, so there is no streak today.
  it("shows evidence-derived rewards: level, no fake streak, earned / locked badges", async () => {
    renderApp("/app/learning", "learner");
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Streak & rewards/i })).toBeInTheDocument(),
    );
    expect(screen.getByTestId("level")).toHaveTextContent(/Level \d+/);
    expect(screen.getByTestId("streak")).toHaveTextContent(/No streak yet/);
    expect(screen.getByLabelText(/First step \(earned\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Heard you \(locked/)).toBeInTheDocument();
    expect(screen.queryByText(/5-day/)).not.toBeInTheDocument();
  });

  it("summarizes learning with stat tiles", async () => {
    renderApp("/app/learning", "learner");
    await waitFor(() => expect(screen.getByText("Courses")).toBeInTheDocument());
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Upcoming")).toBeInTheDocument();
  });

  it("deep-links each upcoming lesson to its course", async () => {
    renderApp("/app/learning", "learner");
    const list = await screen.findByRole("list", { name: "Upcoming lessons" });
    const links = within(list).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(1);
    links.forEach((a) => expect(a.getAttribute("href")).toMatch(/^\/app\/learning\/courses\//));
  });

  it("upcoming lessons are really upcoming (never 'days ago')", async () => {
    renderApp("/app/learning", "learner");
    const list = await screen.findByRole("list", { name: "Upcoming lessons" });
    expect(list.textContent).not.toMatch(/days ago|Yesterday/);
    expect(list.textContent).toMatch(/Today|Tomorrow|In \d+ days/);
  });
});
