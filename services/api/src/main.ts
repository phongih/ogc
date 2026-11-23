/* OGC Platform API process entry (ADR-040). Configuration comes from the environment only. */
import { connect } from "./db.js";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`api: ${name} is required`);
  return v;
}

const db = connect(need("DATABASE_URL")); // the ogc_app role — never the owner role
const app = buildApi({
  db,
  iios: httpIiosClient({
    baseUrl: need("IIOS_URL"),
    clientSecret: need("IIOS_CLIENT_SECRET"),
    timeoutMs: Number(process.env.IIOS_TIMEOUT_MS ?? 2000),
  }),
  logger: true,
});
const port = Number(process.env.PORT ?? 8788);
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.once(sig, () => void app.close().then(() => db.destroy()));
