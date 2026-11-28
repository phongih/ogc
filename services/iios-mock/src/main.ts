/* MOCK IIOS process entry (ADR-040). Dev / staging only — refuses production. */
import pg from "pg";
import { migrate, pgStore, seedIfMissing } from "./pgStore.js";
import { seedPolicies } from "./seed.js";
import { buildIiosMock } from "./server.js";
import { kernelFromEnv } from "./kernel/config.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`iios-mock: ${name} is required`);
  return v;
}

if (process.env.NODE_ENV === "production")
  throw new Error(
    "iios-mock: refuses NODE_ENV=production — it is a dev / staging stand-in for IIOS",
  );

const key = Buffer.from(need("IIOS_MOCK_KEY"), "base64");

// Access policies: in the mock IIOS's own database when IIOS_MOCK_DATABASE_URL is set (VM 2), so
// they survive restarts; otherwise in memory (local dev), reset on every start.
const dbUrl = process.env.IIOS_MOCK_DATABASE_URL;
let store;
if (dbUrl) {
  const pool = new pg.Pool({ connectionString: dbUrl, max: 4 });
  const applied = await migrate(pool);
  const added = await seedIfMissing(pool, seedPolicies());
  console.log(
    `iios-mock: policies in PostgreSQL (migrations applied: ${applied.join(", ") || "none"}; seed policies added: ${added})`,
  );
  store = pgStore(pool);
} else
  console.log("iios-mock: policies in memory (IIOS_MOCK_DATABASE_URL not set) — lost on restart");

// When the IIOS kernel is configured (OGC-ADR-043), role + orgAdmin in resolve come from it.
const kernel = kernelFromEnv(process.env);
console.log(
  kernel
    ? "iios-mock: resolve role/orgAdmin from the IIOS kernel (OGC_IIOS_KERNEL_HOST set)"
    : "iios-mock: resolve role/orgAdmin from the seed directory (kernel not configured)",
);

const { app } = buildIiosMock({
  key,
  clientId: process.env.IIOS_MOCK_CLIENT_ID ?? "ogc",
  clientSecret: need("IIOS_MOCK_CLIENT_SECRET"),
  ...(store ? { store } : {}),
  ...(kernel ? { kernel } : {}),
});
const port = Number(process.env.PORT ?? 8790);
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
console.log(
  `iios-mock listening on ${process.env.HOST ?? "127.0.0.1"}:${port} (synthetic, dev only)`,
);
