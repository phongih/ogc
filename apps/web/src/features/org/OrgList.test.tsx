import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { OrgList } from "./OrgList";

function renderWithProviders(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OrgList", () => {
  it("shows a loading state then renders synthetic organizations", async () => {
    renderWithProviders(<OrgList />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    await waitFor(() => expect(screen.getByText("Nova Learning Group")).toBeInTheDocument());
    expect(screen.getByText("Lumen Education Holdings")).toBeInTheDocument();
  });
});
