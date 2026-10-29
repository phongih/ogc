// Mock session context (NON-PRODUCTION). Holds a fake persona for UI development only.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { createMockSession, type MockSession, type MockPersona } from "@ogc/mock-authz";

interface SessionCtx {
  session: MockSession | null;
  signIn: (persona: MockPersona) => void;
  signOut: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({
  children,
  initialSession = null,
}: {
  children: ReactNode;
  initialSession?: MockSession | null; // used by tests to seed a persona
}) {
  const [session, setSession] = useState<MockSession | null>(initialSession);
  const value = useMemo<SessionCtx>(
    () => ({
      session,
      signIn: (persona) => setSession(createMockSession(persona)),
      signOut: () => setSession(null),
    }),
    [session],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used within SessionProvider");
  return v;
}
