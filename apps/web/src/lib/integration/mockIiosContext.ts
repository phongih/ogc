import type {
  IiosContextPort,
  IiosContextResolution,
  IiosGrantedContext,
} from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";

/*
 * OGC-AUTH-027 / Phase 1 DESIGN — MOCK IIOS boundary (SYNTHETIC; proves nothing about prod IIOS).
 *
 * Plays back the state IIOS would have DECIDED for a presented grant. It does NOT verify any HMAC,
 * does NOT sign, and does NOT issue a principal — OGC is strictly downstream of the trust boundary.
 * The only deny OGC performs at consumption is the tenant-match (active_center/org narrowing,
 * OGC-IIOS-001 §4): a valid grant presented for a different intendedOrgId resolves to cross_tenant.
 */

const ORG = organizations[0].id;

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

export const mockIiosContext: IiosContextPort = {
  resolveContext: async (presentedGrant, intendedOrgId): Promise<IiosContextResolution> => {
    if (!presentedGrant || presentedGrant.trim().length === 0) return { state: "missing" };
    const resolution = GRANTS[presentedGrant];
    if (!resolution) return { state: "missing" }; // unknown token → no sealed context
    if (resolution.state !== "valid" || !resolution.context) return { state: resolution.state };
    // Deny-by-default tenant match (not a grant — a refusal of a mismatch at the boundary).
    if (resolution.context.orgId !== intendedOrgId) return { state: "cross_tenant" };
    return { state: "valid", context: { ...resolution.context } as IiosGrantedContext };
  },
};
