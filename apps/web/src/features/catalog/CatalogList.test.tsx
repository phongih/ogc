import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CatalogList } from "./CatalogList";
import { renderUI } from "../../test/harness";

describe("CatalogList", () => {
  it("renders synthetic courses then filters by query", async () => {
    renderUI(<CatalogList />, { role: "learner" });
    await waitFor(() => expect(screen.getByText("Everyday English A2")).toBeInTheDocument());
    expect(screen.getByText("Conversational English B1")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search courses"), "ielts");
    await waitFor(() => expect(screen.getByText("IELTS Foundation B2")).toBeInTheDocument());
    expect(screen.queryByText("Everyday English A2")).not.toBeInTheDocument();
  });

  it("shows a clearable empty state when filters match nothing", async () => {
    renderUI(<CatalogList />, { role: "learner" });
    await userEvent.type(screen.getByLabelText("Search courses"), "zzzznope");
    await waitFor(() => expect(screen.getByText("No courses match these filters")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("clears filters to restore the full catalog", async () => {
    renderUI(<CatalogList />, { role: "learner" });
    await userEvent.type(screen.getByLabelText("Search courses"), "zzzznope");
    await waitFor(() => expect(screen.getByText("No courses match these filters")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getByText("Everyday English A2")).toBeInTheDocument());
  });

  it("exposes accessible filter controls", () => {
    renderUI(<CatalogList />, { role: "learner" });
    expect(screen.getByLabelText("Filter by level")).toBeInTheDocument();
    const region = screen.getByLabelText("Filter by format");
    expect(within(region.parentElement as HTMLElement).queryByText("All formats")).toBeTruthy();
  });
});
