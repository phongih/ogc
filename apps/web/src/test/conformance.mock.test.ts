import { mockCatalog } from "../lib/adapters/mockCatalog";
import { organizations } from "../fixtures/directory";
import { runCatalogConformance } from "./catalogConformance";

// mockCatalog over the web synthetic fixtures. No unpublished fixture in this data model.
runCatalogConformance({
  name: "mockCatalog",
  port: mockCatalog,
  knownOrgId: organizations[0].id, // Nova — ENG-A2 / ENG-B1 / IELTS-B2
  otherKnownOrgId: organizations[1].id, // Lumen — known, no courses in web fixtures
  unknownOrgId: "00000000-0000-4000-8000-0000000unkn0",
});
