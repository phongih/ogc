import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/harness";

const CENTER_D1 = "00000000-0000-4000-8000-000000000c01";

describe("CenterDetail", () => {
  it("renders the center profile from synthetic fixtures", async () => {
    renderApp(`/app/centers/${CENTER_D1}`, "staff");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Nova English — District 1" })).toBeInTheDocument());
    expect(screen.getByText(/Ho Chi Minh City/)).toBeInTheDocument();
    expect(screen.getByText("10 Synthetic Street")).toBeInTheDocument();
  });

  it("links back to the parent organization", async () => {
    renderApp(`/app/centers/${CENTER_D1}`, "staff");
    await waitFor(() => expect(screen.getByText("10 Synthetic Street")).toBeInTheDocument());

    expect(screen.getByRole("link", { name: /back to organization/i })).toHaveAttribute(
      "href",
      "/app/orgs/00000000-0000-4000-8000-000000000001",
    );
  });
});
