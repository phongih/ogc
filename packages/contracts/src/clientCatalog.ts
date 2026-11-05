import { z } from "zod";

/*
 * OGC-AUTH-027 / Phase 1 DESIGN — Client Catalog Contract (DESIGN-ONLY, SYNTHETIC).
 *
 * Per OGC-DEC-027 (DECIDED — Option C): IIOS is the sole identity/authorization authority and
 * trust-root. The OGC client catalog is **descriptive metadata ONLY**. It never grants tenant
 * access, never decides which orgs a client may act in, never issues/signs/verifies a context,
 * and never writes any authz relation. If the catalog ever starts *deciding* access rather than
 * *describing* clients, it has drifted into a competing trust-root (the rejected Option B) and
 * violates DEC-027 and the signed OGC-IIOS-001 boundary.
 *
 * NON-PRODUCTION: no real registry, no real client onboarding, no persistence.
 */

// Descriptive fields ONLY. `.strict()` rejects any unknown key at parse time (first anti-drift
// line of defence) so an authority-bearing field (e.g. authorizedOrgIds) cannot be smuggled in.
export const ClientCatalogEntry = z
  .object({
    clientId: z.string().min(1),
    displayName: z.string().min(1),
    description: z.string().optional(),
    capabilities: z.array(z.string()).default([]), // human-facing labels, NOT permissions
    contactLabel: z.string().optional(),
  })
  .strict();
export type ClientCatalogEntry = z.infer<typeof ClientCatalogEntry>;

/*
 * Field names that would turn the descriptive catalog into an authorization authority. These are
 * FORBIDDEN on a catalog entry. The list is intentionally broad (names + common synonyms) so the
 * anti-drift guard fails loudly the moment someone tries to attach grant-like data to the catalog.
 */
export const FORBIDDEN_AUTHORITY_FIELDS: readonly string[] = [
  "authorizedOrgIds",
  "orgIds",
  "orgId",
  "tenants",
  "tenantId",
  "allowedOrgs",
  "grants",
  "grant",
  "roles",
  "role",
  "permissions",
  "permission",
  "scopes",
  "scope",
  "principal",
  "principalId",
  "authz",
  "authorization",
  "signingKey",
  "signingKeys",
  "key",
  "keyId",
  "consent",
  "consents",
  "mac",
  "hmac",
  "sealed",
  "trust",
];

/*
 * Runtime anti-drift guard (defence-in-depth beyond `.strict()`): rejects any object that carries
 * an authority-bearing field, at any import path. Throws so the failure is unmissable in tests and
 * review. Catalog data must pass this before it is ever accepted.
 */
export function assertNoAuthorityFields(obj: unknown): void {
  if (!obj || typeof obj !== "object") return;
  const keys = Object.keys(obj as Record<string, unknown>);
  const offending = keys.filter((k) => FORBIDDEN_AUTHORITY_FIELDS.includes(k));
  if (offending.length > 0) {
    throw new Error(
      `ClientCatalog authority-drift: forbidden authority field(s) on a descriptive catalog entry: ${offending.join(", ")}. ` +
        `Authorization is IIOS-granted only (OGC-DEC-027 Option C); the catalog must stay descriptive.`,
    );
  }
}

/*
 * Read-only catalog port. There is DELIBERATELY no register/grant/authorize method — the catalog
 * cannot mint access. Lookups return descriptive metadata and nothing an authorization check may
 * consume.
 */
export interface ClientCatalogPort {
  getClient(clientId: string): Promise<ClientCatalogEntry | null>;
  listClients(): Promise<ClientCatalogEntry[]>;
}
