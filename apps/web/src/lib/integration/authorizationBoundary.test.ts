import { describe, expect, it } from "vitest";
import type { ClientCatalogPort } from "@ogc/contracts";
import { assertNoAuthorityFields, ClientCatalogEntry, requireValidContext } from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";
import { mockClientCatalog } from "./mockClientCatalog";
import { mockIiosContext } from "./mockIiosContext";
import { guardedLearningOperation } from "./guardedDomain";

/*
 * OGC-AUTH-027 / Phase 1 DESIGN — Authorization Boundary Test Matrix (SYNTHETIC, DESIGN-ONLY).
 *
 * Proves three design properties of OGC-DEC-027 Option C:
 *   (1) authorization comes SOLELY from the IIOS-decided context, fail-closed on every non-valid state;
 *   (2) descriptive catalog metadata NEVER affects the grant (no authority drift);
 *   (3) these synthetic tests do NOT prove production IIOS security — they are a boundary-shape check.
 */

const ORG = organizations[0].id;
const OTHER_ORG = organizations[1].id;
const run = <T>(catalog: ClientCatalogPort, args: Parameters<typeof guardedLearningOperation>[2], op: () => T) =>
  guardedLearningOperation(catalog, mockIiosContext, args, op);

describe("Boundary (1) — the IIOS context is the sole gate; fail-closed", () => {
  it("a valid IIOS-granted context admits the domain operation", async () => {
    const out = await run(mockClientCatalog, { presentedGrant: "grant-valid-teacher", intendedOrgId: ORG, clientId: "eduos" }, () => "ran");
    expect(out.ok).toBe(true);
    expect(out.result).toBe("ran");
  });

  it("every non-valid state denies, with the state surfaced (missing/expired/revoked/cross_tenant)", async () => {
    const cases: Array<[string, string, string]> = [
      ["unknown-token", ORG, "iios_context_denied:missing"],
      ["", ORG, "iios_context_denied:missing"],
      ["grant-expired", ORG, "iios_context_denied:expired"],
      ["grant-revoked", ORG, "iios_context_denied:revoked"],
      ["grant-valid-other-org", OTHER_ORG, "iios_context_denied:cross_tenant"], // valid for ORG, presented for OTHER_ORG
    ];
    for (const [grant, org, reason] of cases) {
      const out = await run(mockClientCatalog, { presentedGrant: grant, intendedOrgId: org, clientId: "eduos" }, () => "ran");
      expect(out.ok).toBe(false);
      expect(out.reason).toBe(reason);
      expect(out.result).toBeUndefined(); // the operation never ran
    }
  });

  it("requireValidContext throws IiosContextDenied on a non-valid resolution", () => {
    expect(() => requireValidContext({ state: "revoked" })).toThrowError(/iios_context_denied:revoked/);
    expect(() => requireValidContext({ state: "valid" })).toThrowError(/iios_context_denied:valid/); // valid state but no context ⇒ still deny
  });
});

describe("Boundary (2) — descriptive catalog metadata NEVER affects the grant", () => {
  const emptyCatalog: ClientCatalogPort = { getClient: async () => null, listClients: async () => [] };
  const richCatalog: ClientCatalogPort = {
    getClient: async (id) => ({ clientId: id, displayName: id, capabilities: ["teacher.intervene", "learning.read", "everything"] }),
    listClients: async () => [],
  };

  it("same context ⇒ same gate outcome regardless of catalog contents (full / empty / rich)", async () => {
    for (const cat of [mockClientCatalog, emptyCatalog, richCatalog]) {
      const valid = await run(cat, { presentedGrant: "grant-valid-teacher", intendedOrgId: ORG, clientId: "eduos" }, () => 1);
      const denied = await run(cat, { presentedGrant: "grant-expired", intendedOrgId: ORG, clientId: "eduos" }, () => 1);
      expect(valid.ok).toBe(true); // catalog presence/absence/richness never grants or denies
      expect(denied.ok).toBe(false);
    }
  });

  it("a client absent from the catalog is still admitted when its IIOS context is valid", async () => {
    const out = await run(emptyCatalog, { presentedGrant: "grant-valid-teacher", intendedOrgId: ORG, clientId: "ghost-client" }, () => "ran");
    expect(out.ok).toBe(true);
    expect(out.client).toBeNull(); // no catalog entry, yet authorized — authorization is IIOS-granted
  });

  it("rich capability labels in the catalog do NOT confer access without a valid context", async () => {
    const out = await run(richCatalog, { presentedGrant: "grant-revoked", intendedOrgId: ORG, clientId: "eduos" }, () => "ran");
    expect(out.ok).toBe(false); // 'teacher.intervene' label is descriptive, not a permission
    expect(out.client?.capabilities).toContain("teacher.intervene");
  });

  it("anti-drift: an authority-bearing field on a catalog entry is rejected (guard + strict schema)", () => {
    expect(() => assertNoAuthorityFields({ clientId: "x", displayName: "X", authorizedOrgIds: [ORG] })).toThrowError(/authority-drift/);
    expect(() => assertNoAuthorityFields({ clientId: "x", displayName: "X", roles: ["teacher"] })).toThrowError(/authority-drift/);
    // strict schema rejects the unknown (authority) key at parse time, too
    expect(ClientCatalogEntry.safeParse({ clientId: "x", displayName: "X", authorizedOrgIds: [ORG] }).success).toBe(false);
    // a purely descriptive entry passes both
    expect(() => assertNoAuthorityFields({ clientId: "x", displayName: "X", capabilities: ["learning.read"] })).not.toThrow();
    expect(ClientCatalogEntry.safeParse({ clientId: "x", displayName: "X", capabilities: ["learning.read"] }).success).toBe(true);
  });
});

describe("Boundary (3) — NON-PROOF: this harness does not prove production IIOS security", () => {
  it("OGC never holds verification material — the received context carries no key/mac/signature", async () => {
    const res = await mockIiosContext.resolveContext("grant-valid-teacher", ORG);
    const ctx = requireValidContext(res);
    for (const forbidden of ["hmac", "mac", "signingKey", "key", "keyId", "signature", "sealed"]) {
      expect(forbidden in (ctx as Record<string, unknown>)).toBe(false);
    }
  });

  it("the mock performs NO cryptographic verification — a fixture token is accepted purely because it is a fixture", async () => {
    // There is no signature to forge here: validity is a fixture lookup, by design. This demonstrates
    // the mock is a boundary-SHAPE model, NOT a security proof. Production verification is IIOS's
    // responsibility (OGC-IIOS-001 §3 sealed principal + HMAC), and is explicitly out of scope here.
    const accepted = await mockIiosContext.resolveContext("grant-valid-teacher", ORG);
    const notRecognized = await mockIiosContext.resolveContext("looks-signed-but-unknown", ORG);
    expect(accepted.state).toBe("valid"); // accepted with zero crypto
    expect(notRecognized.state).toBe("missing"); // unknown ⇒ no context, not "verified invalid"
  });
});
