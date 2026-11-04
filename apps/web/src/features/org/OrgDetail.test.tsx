import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "../../test/harness";
import { directory } from "../../lib/api/directory";

const ORG_NOVA = "00000000-0000-4000-8000-000000000001";

afterEach(() => vi.restoreAllMocks());

describe("OrgDetail", () => {
  it("shows the organization with its brands and centers", async () => {
    renderApp(`/app/orgs/${ORG_NOVA}`, "staff");

    // OrgDetail fires three INDEPENDENT queries (org, brands, centers). The org heading can
    // commit before the brands/centers queries have flushed, so each async section must be
    // awaited with findBy* — asserting them synchronously after only the org heading is a
    // race (the historical intermittent failure). The section headings are static once org
    // loads, so they stay getBy.
    expect(await screen.findByRole("heading", { name: "Nova Learning Group" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brands" })).toBeInTheDocument();
    expect(await screen.findByText("Nova English")).toBeInTheDocument();
    expect(await screen.findByText("Nova Juniors")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Centers" })).toBeInTheDocument();
    expect(await screen.findByText("Nova English — District 1")).toBeInTheDocument();
  });

  it("renders centers even when the centers query resolves after the org (race regression guard)", async () => {
    // Deterministically force the worst-case ordering the flake needed: the org resolves
    // immediately while centers flush well after. This is not a mask — a regression back to a
    // synchronous getByText for centers (asserting before the centers query resolves) would
    // fail here every run; the fixed awaiting pattern passes.
    const realGetOrg = directory.getOrganization.bind(directory);
    const realListCenters = directory.listCenters.bind(directory);
    vi.spyOn(directory, "getOrganization").mockImplementation((orgId) => Promise.resolve(realGetOrg(orgId)));
    vi.spyOn(directory, "listCenters").mockImplementation((orgId, brandId) =>
      new Promise((resolve) => setTimeout(() => resolve(realListCenters(orgId, brandId)), 300)),
    );

    renderApp(`/app/orgs/${ORG_NOVA}`, "staff");

    // Org resolves first; at this instant centers are provably NOT yet rendered (the race
    // window the old synchronous assertion fell into).
    expect(await screen.findByRole("heading", { name: "Nova Learning Group" })).toBeInTheDocument();
    expect(screen.queryByText("Nova English — District 1")).toBeNull();
    // The awaited assertion waits for the lagging centers query, then finds the center.
    expect(await screen.findByText("Nova English — District 1")).toBeInTheDocument();
  });

  it("links a center through to its detail page", async () => {
    renderApp(`/app/orgs/${ORG_NOVA}`, "staff");
    await waitFor(() => expect(screen.getByText("Nova English — District 1")).toBeInTheDocument());

    const centerLink = screen.getByText("Nova English — District 1").closest("a");
    expect(centerLink).toHaveAttribute("href", "/app/centers/00000000-0000-4000-8000-000000000c01");
  });

  it("exposes a breadcrumb landmark back to the directory root", async () => {
    renderApp(`/app/orgs/${ORG_NOVA}`, "staff");
    await waitFor(() => expect(screen.getByRole("heading", { name: "Nova Learning Group" })).toBeInTheDocument());

    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumb).getByRole("link", { name: "Organizations" })).toHaveAttribute("href", "/app/orgs");
  });
});
