/*
 * ============================================================================
 *  NON-PRODUCTION MOCK AUTHORIZATION — DO NOT USE IN ANY TRUSTED RUNTIME.
 * ----------------------------------------------------------------------------
 *  This module fakes a signed-in session for UI development on synthetic data.
 *  It performs NO real authentication or authorization. It intentionally does
 *  NOT implement the P2 sealed-principal model and MUST NOT be wired to the
 *  frozen IIOS security source (r1) or any real backend.
 *
 *  When G2-C PASSes and the r2 remediation is authorized, this is replaced by a
 *  governed backend adapter behind the same interface (contracts requirement #5).
 * ============================================================================
 */

export const NON_PRODUCTION = true as const;

export type MockRole = "staff" | "teacher" | "guardian" | "learner";

export interface MockSession {
  readonly nonProduction: true;
  personaId: string;
  displayName: string;
  role: MockRole;
  orgId: string; // the tenant root this synthetic persona belongs to
}

export interface MockPersona {
  personaId: string;
  displayName: string;
  role: MockRole;
  orgId: string;
}

/** Create a fake session for a chosen synthetic persona. No credentials involved. */
export function createMockSession(persona: MockPersona): MockSession {
  return { nonProduction: true, ...persona };
}

/**
 * Placeholder visibility check for UI gating ONLY (e.g. which nav items to show).
 * This is NOT a security boundary and never will be. Real authorization is
 * enforced server-side by the governed model once available.
 */
export function mockCanView(session: MockSession | null, section: string): boolean {
  if (!session) return false;
  const byRole: Record<MockRole, string[]> = {
    staff: ["directory", "catalog", "tutor", "learners", "teachers"],
    teacher: ["catalog", "tutor", "learners"],
    guardian: ["catalog", "tutor"],
    learner: ["catalog", "tutor"],
  };
  return byRole[session.role].includes(section);
}
