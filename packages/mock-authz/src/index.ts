/*
 * ============================================================================
 *  NON-PRODUCTION MOCK AUTHORIZATION — DO NOT USE IN ANY TRUSTED RUNTIME.
 * ----------------------------------------------------------------------------
 *  Fakes a signed-in session for UI development on synthetic data. Performs NO
 *  real authentication or authorization. Does NOT implement the P2 sealed-
 *  principal model and MUST NOT be wired to the frozen IIOS security source
 *  (r1) or any real backend. `mockCanView` only gates UI navigation; it is NOT
 *  a security boundary. Replaced by a governed backend adapter once G2-C passes.
 * ============================================================================
 */

export const NON_PRODUCTION = true as const;

export type MockRole = "admin" | "staff" | "teacher" | "guardian" | "learner";

/** UI navigation sections (not permissions). */
export type Section =
  | "directory"
  | "operations"
  | "access"
  | "learning"
  | "teaching"
  | "catalog"
  | "tutor"
  | "guardian"
  | "referrals";

export interface MockSession {
  readonly nonProduction: true;
  personaId: string;
  displayName: string;
  role: MockRole;
  orgId: string; // tenant root this synthetic persona belongs to
}

export interface MockPersona {
  personaId: string;
  displayName: string;
  role: MockRole;
  orgId: string;
}

export function createMockSession(persona: MockPersona): MockSession {
  return { nonProduction: true, ...persona };
}

const SECTIONS_BY_ROLE: Record<MockRole, Section[]> = {
  // Org Admin: everything staff sees, plus access policies (never their own — see the adapter).
  admin: [
    "directory",
    "operations",
    "access",
    "catalog",
    "tutor",
    "teaching",
    "learning",
    "guardian",
  ],
  staff: ["directory", "operations", "catalog", "tutor", "teaching", "learning", "guardian"],
  teacher: ["teaching", "catalog", "tutor"],
  // Referrals: the page itself decides (guardians and ADULT learners only; minors see a note).
  guardian: ["guardian", "referrals", "catalog", "tutor"],
  learner: ["learning", "referrals", "catalog", "tutor"],
};

/**
 * UI-only visibility check. Fail-closed: no session, or section not listed for
 * the role, returns false. NOT a security control and never will be.
 */
export function mockCanView(session: MockSession | null, section: Section): boolean {
  if (!session) return false;
  return SECTIONS_BY_ROLE[session.role].includes(section);
}

export function sectionsFor(session: MockSession | null): Section[] {
  if (!session) return [];
  return SECTIONS_BY_ROLE[session.role];
}

/*
 * D-14 (Guardian Self-Verification Prohibition). A guardian MUST NOT be able to
 * self-assert or self-verify a relationship to a learner through this UI. The
 * governed backend establishes natural-person identity and guardian links; this
 * mock deliberately provides NO path to do so and always denies. This is a
 * placeholder marking an UNRESOLVED security requirement — not an implementation.
 */
export function mockGuardianCanSelfVerify(): false {
  return false;
}
