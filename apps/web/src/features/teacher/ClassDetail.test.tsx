import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/harness";

const CLASS_A2 = "00000000-0000-4000-8000-0000000000k1";

describe("ClassDetail", () => {
  it("renders the class roster for the teacher", async () => {
    renderApp(`/app/teaching/classes/${CLASS_A2}`, "teacher");

    await waitFor(() => expect(screen.getByText("Linh N.")).toBeInTheDocument());
    expect(screen.getByText("Minh T.")).toBeInTheDocument();
    expect(screen.getByText("An P.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Learner overview" })).toBeInTheDocument();
  });

  it("offers a link into the lesson plan editor for the class", async () => {
    renderApp(`/app/teaching/classes/${CLASS_A2}`, "teacher");
    await waitFor(() => expect(screen.getByText("Linh N.")).toBeInTheDocument());

    const link = screen.getByRole("link", { name: /open lesson plan editor/i });
    expect(link).toHaveAttribute("href", `/app/teaching/classes/${CLASS_A2}/plan`);
  });

  it("summarizes class progress as an equal-weight ring over authorized learners", async () => {
    renderApp(`/app/teaching/classes/${CLASS_A2}`, "teacher");

    // The ring's value loads once the authorization-checked class progress resolves.
    const ring = await screen.findByRole("progressbar", { name: "Class progress" });
    await waitFor(() => expect(Number(ring.getAttribute("aria-valuenow"))).toBeGreaterThan(0));
    expect(screen.getByText(/equal-weight average/i)).toBeInTheDocument();
  });
});
