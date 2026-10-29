import { createCatalogServer } from "./server.js";

// Local-only entrypoint. Binds to 127.0.0.1 exclusively — never 0.0.0.0.
// NON-PRODUCTION: synthetic data, no DB, no credentials, no external services.
const PORT = Number(process.env.OGC_CATALOG_PORT ?? 8787);
const HOST = "127.0.0.1";

const server = createCatalogServer();
server.listen(PORT, HOST, () => {
  console.log(`[catalog-api] NON-PRODUCTION synthetic server on http://${HOST}:${PORT}/api/v1`);
});
