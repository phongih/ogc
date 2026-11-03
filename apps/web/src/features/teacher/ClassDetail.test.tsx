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
});
