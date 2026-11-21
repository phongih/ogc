// OGC-AUTH-027 / Phase 2 — the IIOS-context gate wired into /app (SYNTHETIC, MOCK).
// Proves the UI honours the boundary's decision fail-closed. Proves NOTHING about production IIOS.
import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { createMockSession, type MockRole } from "@ogc/mock-authz";
import type { IiosContextPort, IiosContextResolution } from "@ogc/contracts";
import { SessionProvider } from "./session";
import { routes } from "./router";
import { IiosContextProvider, presentedGrantFor, type IiosScenario } from "./iiosGate";
import { mockIiosContext } from "../lib/integration/mockIiosContext";
import { persona } from "../test/harness";

function renderGated(
  path: string,
  role: MockRole | null,
  opts: { scenario?: IiosScenario; port?: IiosContextPort } = {},
) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const session = role ? createMockSession(persona(role)) : null;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: 0 } } })}>
      <SessionProvider initialSession={session}>
        <IiosContextProvider
          port={opts.port ?? mockIiosContext}
          initialScenario={opts.scenario ?? "valid"}
        >
          <RouterProvider router={router} />
        </IiosContextProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return router;
}

const ORG = "00000000-0000-4000-8000-000000000001";
const VALID: IiosContextResolution = {
  state: "valid",
  context: {
    clientId: "eduos",
    orgId: ORG,
    principalId: "iios-principal-learner-1",
    role: "learner",
    purpose: "learning.read",
    requestId: "req-test",
    grantRef: "ref-test",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

describe("AUTH-027 Phase 2 — /app behind the IIOS-granted context", () => {
  it.each(["staff", "teacher", "learner", "guardian"] as MockRole[])(
    "a valid grant admits the %s persona (no closed screen)",
    async (role) => {
      renderGated("/app/catalog", role);
      await waitFor(() => expect(screen.getByText("Course catalog")).toBeInTheDocument());
      expect(document.querySelector("[data-iios-state]")).toBeNull();
    },
  );

  it.each([
    ["expired", "Your access grant has expired"],
    ["revoked", "Your access grant was revoked"],
    ["missing", "No access grant was presented"],
    ["cross_tenant", "This grant belongs to a different organization"],
  ] as [IiosScenario, string][])(
    "%s → closed, state-specific screen and the feature is NOT rendered",
    async (scenario, title) => {
      renderGated("/app/catalog", "learner", { scenario });
      await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
      expect(document.querySelector(`[data-iios-state="${scenario}"]`)).toBeTruthy();
      expect(screen.queryByText("Course catalog")).toBeNull();
      // the shell (nav + sign out) stays usable so the user can leave
      expect(screen.getAllByRole("button", { name: "Sign out" }).length).toBeGreaterThan(0);
    },
  );

  it("is closed while the decision is pending", async () => {
    const pending: IiosContextPort = { resolveContext: () => new Promise(() => {}) };
    renderGated("/app/catalog", "learner", { port: pending });
    expect(await screen.findByRole("status")).toHaveTextContent("Checking access with IIOS");
    expect(screen.queryByText("Course catalog")).toBeNull();
  });

  it("a failing boundary is not a grant: resolves to the missing (deny) screen", async () => {
    const broken: IiosContextPort = { resolveContext: () => Promise.reject(new Error("boom")) };
    renderGated("/app/catalog", "learner", { port: broken });
    await waitFor(() =>
      expect(screen.getByText("No access grant was presented")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Course catalog")).toBeNull();
  });

  it("presents the persona's own grant for the session's own tenant (OGC verifies nothing)", async () => {
    const spy = vi.fn(mockIiosContext.resolveContext);
    renderGated("/app/catalog", "learner", { port: { resolveContext: spy } });
    await waitFor(() => expect(screen.getByText("Course catalog")).toBeInTheDocument());
    expect(spy).toHaveBeenCalledWith("grant-valid-learner", ORG);
  });

  it("re-consults IIOS on every navigation: an upstream revocation closes the next screen", async () => {
    let decision: IiosContextResolution = VALID;
    const scripted: IiosContextPort = { resolveContext: vi.fn(async () => decision) };
    const router = renderGated("/app/catalog", "learner", { port: scripted });
    await waitFor(() => expect(screen.getByText("Course catalog")).toBeInTheDocument());
    const callsBefore = (scripted.resolveContext as ReturnType<typeof vi.fn>).mock.calls.length;

    decision = { state: "revoked" }; // IIOS revokes upstream (e.g. consent withdrawn)
    await act(() => router.navigate("/app/learning"));
    await waitFor(() =>
      expect(screen.getByText("Your access grant was revoked")).toBeInTheDocument(),
    );
    expect((scripted.resolveContext as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
      callsBefore,
    );
  });

  it("does not replace persona gating: an admitted learner still cannot open the directory", async () => {
    renderGated("/app/orgs", "learner");
    await waitFor(() =>
      expect(screen.getByText("Not available for this persona")).toBeInTheDocument(),
    );
  });

  it("mock sign-in can simulate an IIOS decision; a revoked grant closes the app after sign-in", async () => {
    const user = userEvent.setup();
    renderGated("/login", null);
    await user.selectOptions(screen.getByRole("combobox"), "revoked");
    await user.click(screen.getByRole("button", { name: /Linh \(Learner\)/ }));
    await waitFor(() =>
      expect(screen.getByText("Your access grant was revoked")).toBeInTheDocument(),
    );
  });

  it("an unknown persona presents nothing; non-valid scenarios never present a persona grant", () => {
    expect(presentedGrantFor("someone-else", "valid")).toBe("");
    expect(presentedGrantFor("demo-learner", "missing")).toBe("");
    expect(presentedGrantFor("demo-learner", "expired")).toBe("grant-expired");
    expect(presentedGrantFor("demo-learner", "revoked")).toBe("grant-revoked");
  });
});
