import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/harness";

// AppHome is the post-login router: it lands each persona on the first section
// their role can view (SECTIONS_BY_ROLE[role][0]). Fail-closed to /login with no session.
describe("AppHome landing redirect", () => {
  it("lands a staff persona on the directory (first staff section)", async () => {
    renderApp("/app", "staff");
    await waitFor(() => expect(screen.getByText("Organizations")).toBeInTheDocument());
  });

  it("lands a teacher persona on teaching (first teacher section)", async () => {
    renderApp("/app", "teacher");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Teaching" })).toBeInTheDocument());
  });

  it("lands a learner persona on their learning section", async () => {
    renderApp("/app", "learner");
    await waitFor(() => expect(screen.getByText(/my learning/i)).toBeInTheDocument());
  });
});
