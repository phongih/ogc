/*
 * CredentialVerifier for staging: a FAKE "Credly (mock)" register (owner 24/11). It never calls the
 * network and knows no real person — the badge code alone decides:
 *   MOCK-…      valid
 *   MOCK-…-R    revoked by the issuer
 *   MOCK-…-X    expired at the issuer
 *   anything else: unknown to the register.
 * A real Credly connection is later work behind its own gate; it would implement the same port.
 */
import type { CredentialCheck, CredentialVerifier } from "@ogc/contracts";

export const fakeCredly: CredentialVerifier = {
  source: "credly_mock",
  async check(code: string): Promise<CredentialCheck> {
    if (!/^MOCK-[A-Z0-9][A-Z0-9-]*$/.test(code)) return "unknown";
    if (code.endsWith("-R")) return "revoked";
    if (code.endsWith("-X")) return "expired";
    return "valid";
  },
};
