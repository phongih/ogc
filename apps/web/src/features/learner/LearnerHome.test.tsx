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

  it("deep-links each upcoming lesson to its course", async () => {
    renderApp("/app/learning", "learner");
    const list = await screen.findByRole("list", { name: "Upcoming lessons" });
    const links = within(list).getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(1);
    links.forEach((a) => expect(a.getAttribute("href")).toMatch(/^\/app\/learning\/courses\//));
  });
});
