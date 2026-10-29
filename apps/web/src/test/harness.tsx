import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import { createMockSession, type MockPersona, type MockRole } from "@ogc/mock-authz";
import { SessionProvider } from "../app/session";
import { routes } from "../app/router";
import { NonProductionBanner } from "../ui";

const ORG = "00000000-0000-4000-8000-000000000001";
export function persona(role: MockRole): MockPersona {
  const id =
    role === "learner" ? "demo-learner" : role === "teacher" ? "demo-teacher" : role === "guardian" ? "demo-guardian" : "demo-staff";
  return { personaId: id, displayName: `${role} demo`, role, orgId: ORG };
}

function newQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
}

/** Render a single component with providers and a router (no app routes). */
export function renderUI(ui: ReactNode, opts?: { role?: MockRole }) {
  const session = opts?.role ? createMockSession(persona(opts.role)) : null;
  return render(
    <QueryClientProvider client={newQc()}>
      <SessionProvider initialSession={session}>
        <MemoryRouter>{ui}</MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

/** Render the real application routes at a deep link, with a seeded persona. */
export function renderApp(initialPath: string, role: MockRole) {
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const session = createMockSession(persona(role));
  return render(
    <QueryClientProvider client={newQc()}>
      <SessionProvider initialSession={session}>
        {/* mirror the App-level chrome so a11y / non-production smoke is meaningful */}
        <a href="#main" className="ogc-skip-link">
          Skip to content
        </a>
        <NonProductionBanner />
        <RouterProvider router={router} />
      </SessionProvider>
    </QueryClientProvider>,
  );
}
