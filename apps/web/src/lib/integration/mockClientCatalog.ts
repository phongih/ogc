import type { ClientCatalogEntry, ClientCatalogPort } from "@ogc/contracts";
import { ClientCatalogEntry as ClientCatalogEntrySchema, assertNoAuthorityFields } from "@ogc/contracts";

/*
 * OGC-AUTH-027 / Phase 1 DESIGN — MOCK client catalog (SYNTHETIC). Descriptive metadata ONLY.
 * Every entry is parsed by the strict schema AND passed through the anti-drift guard, so an
 * authority-bearing field can never enter the catalog. Nothing here is consumed by an
 * authorization decision (see guardedDomain.ts).
 */

const RAW: ClientCatalogEntry[] = [
  {
    clientId: "eduos",
    displayName: "EduOS",
    description: "Institutional client (one client among peers; not the authority).",
    capabilities: ["learning.read", "teacher.intervene"],
    contactLabel: "EduOS integrations",
  },
  {
    clientId: "partner-b",
    displayName: "Independent partner client",
    description: "Third-party client integrating via the IIOS-granted context.",
    capabilities: ["learning.read"],
  },
];

// Validate at module load: strict parse rejects unknown keys; the guard rejects authority fields.
const ENTRIES: ClientCatalogEntry[] = RAW.map((e) => {
  assertNoAuthorityFields(e);
  return ClientCatalogEntrySchema.parse(e);
});

export const mockClientCatalog: ClientCatalogPort = {
  getClient: async (clientId) => ENTRIES.find((e) => e.clientId === clientId) ?? null,
  listClients: async () => ENTRIES.map((e) => ({ ...e })),
};
