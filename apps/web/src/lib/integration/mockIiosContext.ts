import type { IiosContextPort, IiosContextResolution, IiosGrantedContext } from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";
import { isOrgAdmin, narrowingFor } from "./mockIiosPolicy";

/*
 * OGC-AUTH-027 / Phase 1 DESIGN — MOCK IIOS boundary (SYNTHETIC; proves nothing about prod IIOS).
 *
 * Plays back the state IIOS would have DECIDED for a presented grant. It does NOT verify any HMAC,
 * does NOT sign, and does NOT issue a principal — OGC is strictly downstream of the trust boundary.
 * The only deny OGC performs at consumption is the tenant-match (active_center/org narrowing,
 * OGC-IIOS-001 §4): a valid grant presented for a different intendedOrgId resolves to cross_tenant.
 */

const ORG = organizations[0].id;
const ORG2 = organizations[1].id; // a different tenant root (cross_tenant scenario)

// Synthetic sealed grants, keyed by an opaque presented token. In production these come from the
// IIOS-signed context; here they are fixtures carrying NO key/mac (OGC never sees verification data).
const GRANTS: Record<string, IiosContextResolution> = {
  "grant-valid-teacher": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG,
      principalId: "iios-principal-teacher-1",
      role: "teacher",
      purpose: "learning.read",
      requestId: "req-synth-0001",
      grantRef: "iios-grant-ref-0001",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  "grant-valid-learner": {
    state: "valid",
    context: {
      clientId: "partner-b",
      orgId: ORG,
      principalId: "iios-principal-learner-1",
      role: "learner",
      purpose: "learning.read",
      requestId: "req-synth-0002",
      grantRef: "iios-grant-ref-0002",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  // AUTH-027 Phase 2 (additive): grants for the remaining demo personas, so every persona reaches
  // the app through the same IIOS-context gate. Synthetic; no key/mac.
  "grant-valid-staff": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG,
      principalId: "iios-principal-staff-1",
      role: "staff",
      purpose: "learning.read",
      requestId: "req-synth-0004",
      grantRef: "iios-grant-ref-0004",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  // Access policy (additive): the Org Admin. IIOS has no "admin" actor role — it grants "staff";
  // "Org Admin" is an OGC membership attribute (see fixtures/personas.ts). Synthetic; no key/mac.
  "grant-valid-admin": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG,
      principalId: "iios-principal-admin-1",
      role: "staff",
      purpose: "learning.read",
      requestId: "req-synth-0008",
      grantRef: "iios-grant-ref-0008",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  // ADR-039 step 3b (additive): grants for the remaining synthetic personas, so every adapter call
  // — tests included — carries an IIOS-decided context. Synthetic; no key/mac.
  "grant-valid-learner-2": {
    state: "valid",
    context: {
      clientId: "partner-b",
      orgId: ORG,
      principalId: "iios-principal-learner-2",
      role: "learner",
      purpose: "learning.read",
      requestId: "req-synth-0009",
      grantRef: "iios-grant-ref-0009",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  "grant-valid-learner-org2": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG2,
      principalId: "iios-principal-learner-org2",
      role: "learner",
      purpose: "learning.read",
      requestId: "req-synth-0010",
      grantRef: "iios-grant-ref-0010",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  // P2 (additive): the second demo teacher (substitute / reassignment). Synthetic; no key/mac.
  "grant-valid-teacher-2": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG,
      principalId: "iios-principal-teacher-2",
      role: "teacher",
      purpose: "learning.read",
      requestId: "req-synth-0007",
      grantRef: "iios-grant-ref-0007",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  "grant-valid-guardian": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG,
      principalId: "iios-principal-guardian-1",
      role: "guardian",
      purpose: "learning.read",
      requestId: "req-synth-0005",
      grantRef: "iios-grant-ref-0005",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  // A grant IIOS scoped to a DIFFERENT tenant root — presented for ORG it resolves to cross_tenant.
  "grant-valid-org2": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG2,
      principalId: "iios-principal-staff-org2",
      role: "staff",
      purpose: "learning.read",
      requestId: "req-synth-0006",
      grantRef: "iios-grant-ref-0006",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
  // IIOS decided this grant has expired — OGC honours the decision, it does not re-check the clock.
  "grant-expired": { state: "expired" },
  // IIOS decided this grant was revoked (e.g. consent withdrawn).
  "grant-revoked": { state: "revoked" },
  // A grant valid for ORG — used to prove cross_tenant deny when presented for another org.
  "grant-valid-other-org": {
    state: "valid",
    context: {
      clientId: "eduos",
      orgId: ORG,
      principalId: "iios-principal-teacher-2",
      role: "teacher",
      purpose: "learning.read",
      requestId: "req-synth-0003",
      grantRef: "iios-grant-ref-0003",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  },
};

// The opaque token each demo persona presents when its grant is valid. Synthetic fixtures only.
const VALID_GRANT_BY_PERSONA: Record<string, string> = {
  "demo-admin": "grant-valid-admin",
  "demo-staff": "grant-valid-staff",
  "demo-teacher": "grant-valid-teacher",
  "demo-teacher-2": "grant-valid-teacher-2",
  "demo-learner": "grant-valid-learner",
  "demo-guardian": "grant-valid-guardian",
  "demo-learner-2": "grant-valid-learner-2",
  "demo-staff-org2": "grant-valid-org2",
  "demo-learner-org2": "grant-valid-learner-org2",
};
export const validGrantTokenFor = (personaId: string): string =>
  VALID_GRANT_BY_PERSONA[personaId] ?? "";

/** The boundary's decision, synchronously (the mock has no I/O). */
export function resolveGrantSync(
  presentedGrant: string,
  intendedOrgId: string,
): IiosContextResolution {
  if (!presentedGrant || presentedGrant.trim().length === 0) return { state: "missing" };
  const resolution = GRANTS[presentedGrant];
  if (!resolution) return { state: "missing" }; // unknown token → no sealed context
  if (resolution.state !== "valid" || !resolution.context) return { state: resolution.state };
  // Deny-by-default tenant match (not a grant — a refusal of a mismatch at the boundary).
  if (resolution.context.orgId !== intendedOrgId) return { state: "cross_tenant" };
  // OGC-ADR-039 step 2: IIOS also decides the org-admin attribute and the narrowing for this
  // principal at resolve time (re-consulted on every navigation, never cached by OGC).
  const c = resolution.context;
  return {
    state: "valid",
    context: {
      ...c,
      orgAdmin: isOrgAdmin(c.principalId, c.orgId),
      narrowing: narrowingFor(c.principalId, c.orgId),
    } as IiosGrantedContext,
  };
}

export const mockIiosContext: IiosContextPort = {
  resolveContext: async (presentedGrant, intendedOrgId): Promise<IiosContextResolution> =>
    resolveGrantSync(presentedGrant, intendedOrgId),
};
