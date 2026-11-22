/*
 * OGC-AUTH-027 / Phase 2 — the IIOS-granted context, WIRED into the app (SYNTHETIC, MOCK).
 *
 * Phase 1 (PR #15) defined the contract and the single choke-point `requireValidContext`, dormant.
 * This module puts every /app route behind it:
 *   - the session presents an OPAQUE grant token (here: a synthetic fixture chosen at mock login);
 *   - the IIOS boundary (mocked) DECIDES the state; OGC never verifies, signs or decodes anything;
 *   - anything other than "valid" renders a closed, state-specific screen — deny by default;
 *   - the decision is re-requested on EVERY navigation (no locally cached authorization), so a
 *     revocation upstream closes the very next screen.
 *
 * This is NOT a security control and proves nothing about production IIOS security. It sits on top
 * of the existing mock persona gating (RequireSection), which is unchanged.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type {
  IiosContextPort,
  IiosContextResolution,
  IiosContextState,
  IiosGrantedContext,
} from "@ogc/contracts";
import { requireValidContext } from "@ogc/contracts";
import { mockIiosContext, validGrantTokenFor } from "../lib/integration/mockIiosContext";
import { setCurrentGrant } from "../lib/integration/currentGrant";
import { useSession } from "./session";
import { Button, EmptyState, PageHeader, Spinner } from "../ui";

/** Demo scenarios: which decision the mock IIOS boundary will return for this session. */
export const IIOS_SCENARIOS = ["valid", "expired", "revoked", "missing", "cross_tenant"] as const;
export type IiosScenario = (typeof IIOS_SCENARIOS)[number];

// Non-valid scenarios present a token the boundary decides against. OGC does not compute these.
const SCENARIO_GRANT: Record<Exclude<IiosScenario, "valid">, string> = {
  expired: "grant-expired",
  revoked: "grant-revoked",
  missing: "", // nothing presented
  cross_tenant: "grant-valid-org2", // valid, but scoped by IIOS to another tenant
};

/** The opaque grant a persona presents under a scenario. Unknown persona → nothing presented. */
export function presentedGrantFor(personaId: string, scenario: IiosScenario): string {
  if (scenario !== "valid") return SCENARIO_GRANT[scenario];
  return validGrantTokenFor(personaId);
}

interface IiosCtx {
  port: IiosContextPort;
  scenario: IiosScenario;
  setScenario: (s: IiosScenario) => void;
}

// Default (no provider): the mock boundary with every persona presenting its valid grant.
const Ctx = createContext<IiosCtx>({
  port: mockIiosContext,
  scenario: "valid",
  setScenario: () => {},
});

export function IiosContextProvider({
  children,
  port = mockIiosContext,
  initialScenario = "valid",
}: {
  children: ReactNode;
  port?: IiosContextPort; // tests inject a scripted boundary
  initialScenario?: IiosScenario;
}) {
  const [scenario, setScenario] = useState<IiosScenario>(initialScenario);
  const value = useMemo(() => ({ port, scenario, setScenario }), [port, scenario]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useIiosScenario(): Pick<IiosCtx, "scenario" | "setScenario"> {
  const { scenario, setScenario } = useContext(Ctx);
  return { scenario, setScenario };
}

const GrantedCtx = createContext<IiosGrantedContext | null>(null);

/** The IIOS-granted context for the current screen. Only non-null inside an admitted route. */
export function useGrantedContext(): IiosGrantedContext | null {
  return useContext(GrantedCtx);
}

const DENIED_COPY: Record<Exclude<IiosContextState, "valid">, { title: string; hint: string }> = {
  missing: {
    title: "No access grant was presented",
    hint: "Access to this workspace is granted by IIOS. Sign in again to obtain a grant.",
  },
  expired: {
    title: "Your access grant has expired",
    hint: "IIOS reports this grant is no longer current. Sign in again to obtain a new one.",
  },
  revoked: {
    title: "Your access grant was revoked",
    hint: "IIOS revoked this grant (for example, consent was withdrawn). Contact your organization.",
  },
  cross_tenant: {
    title: "This grant belongs to a different organization",
    hint: "The grant IIOS issued is scoped to another organization and cannot be used here.",
  },
};

type GateState = { phase: "pending" } | { phase: "decided"; resolution: IiosContextResolution };

/**
 * Wraps the /app outlet. Renders children ONLY when the boundary decided "valid" for the grant the
 * session presents, in the session's own tenant. Pending and every other state render closed.
 */
export function RequireIiosContext({ children }: { children: ReactNode }) {
  const { session, signOut } = useSession();
  const { port, scenario } = useContext(Ctx);
  const { pathname } = useLocation();
  const [gate, setGate] = useState<GateState>({ phase: "pending" });

  const personaId = session?.personaId ?? "";
  const orgId = session?.orgId ?? "";

  useEffect(() => {
    let live = true;
    setGate({ phase: "pending" }); // fail-closed while the decision is outstanding
    port
      .resolveContext(presentedGrantFor(personaId, scenario), orgId)
      .then((resolution) => {
        if (!live) return;
        // OGC-ADR-039 step 3: the adapters enforce with THIS grant (null = denied → nothing allowed).
        setCurrentGrant(
          personaId,
          resolution.state === "valid" && resolution.context ? resolution.context : null,
        );
        setGate({ phase: "decided", resolution });
      })
      // A boundary failure is not a grant: treat as missing (deny).
      .catch(() => {
        if (!live) return;
        setCurrentGrant(personaId, null);
        setGate({ phase: "decided", resolution: { state: "missing" } });
      });
    return () => {
      live = false;
    };
    // pathname: re-consult IIOS on every navigation — no locally cached authorization.
  }, [port, scenario, personaId, orgId, pathname]);

  if (gate.phase === "pending") return <Spinner label="Checking access with IIOS" />;

  let granted: IiosGrantedContext;
  try {
    granted = requireValidContext(gate.resolution); // the single choke-point (Phase 1)
  } catch {
    const state = gate.resolution.state as Exclude<IiosContextState, "valid">;
    const copy = DENIED_COPY[state] ?? DENIED_COPY.missing;
    return (
      <section data-iios-state={state}>
        <PageHeader title={copy.title} />
        <EmptyState
          title={copy.hint}
          hint="Synthetic IIOS boundary (mock) — not a production security control."
        />
        <div className="mt-4">
          <Button variant="ghost" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </section>
    );
  }
  return <GrantedCtx.Provider value={granted}>{children}</GrantedCtx.Provider>;
}
