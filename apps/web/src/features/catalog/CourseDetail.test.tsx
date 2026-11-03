import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { courses } from "../../fixtures/catalog";

// courses[2] (IELTS-B2) is NOT in the demo learner's seeded enrollments.
const UNENROLLED = courses[2].id;

describe("CourseDetail enrollment", () => {
  it("lets a learner enroll, then offers Resume learning", async () => {
    renderApp(`/app/catalog/${UNENROLLED}`, "learner");

    const enrollBtn = await waitFor(() => screen.getByRole("button", { name: /enroll in/i }));
    await userEvent.click(enrollBtn);

    // After enrolling, the shared state flips to enrolled and the resume action appears.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /resume learning/i })).toBeInTheDocument(),
    );
  });

  it("shows level/format badges and related-course deep-links", async () => {
    renderApp(`/app/catalog/${courses[0].id}`, "learner");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Everyday English A2" })).toBeInTheDocument());

    // Level + format rendered as badges (format also appears in the detail list).
    expect(screen.getByText("A2")).toBeInTheDocument();
    expect(screen.getAllByText("in center").length).toBeGreaterThanOrEqual(1);

    // Related section deep-links to other catalog courses.
    await screen.findByRole("heading", { name: "Related courses" });
    const relatedLinks = screen
      .getAllByRole("link")
      .filter((a) => /^\/app\/catalog\/.+/.test(a.getAttribute("href") ?? ""));
    expect(relatedLinks.length).toBeGreaterThanOrEqual(1);
  });
});
