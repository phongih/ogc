import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderApp } from "../../test/harness";

const ORG_NOVA = "00000000-0000-4000-8000-000000000001";

describe("OrgDetail", () => {
  it("shows the organization with its brands and centers", async () => {
    renderApp(`/app/orgs/${ORG_NOVA}`, "staff");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Nova Learning Group" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Brands" })).toBeInTheDocument();
    expect(screen.getByText("Nova English")).toBeInTheDocument();
    expect(screen.getByText("Nova Juniors")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Centers" })).toBeInTheDocument();
    expect(screen.getByText("Nova English — District 1")).toBeInTheDocument();
  });

  it("links a center through to its detail page", async () => {
    renderApp(`/app/orgs/${ORG_NOVA}`, "staff");
    await waitFor(() => expect(screen.getByText("Nova English — District 1")).toBeInTheDocument());

    const centerLink = screen.getByText("Nova English — District 1").closest("a");
    expect(centerLink).toHaveAttribute("href", "/app/centers/00000000-0000-4000-8000-000000000c01");
  });
});
