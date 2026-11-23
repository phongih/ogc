/* MOCK IIOS process entry (ADR-040). Dev / staging only — refuses production. */
import { buildIiosMock } from "./server.js";

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
const { app } = buildIiosMock({
  key,
  clientId: process.env.IIOS_MOCK_CLIENT_ID ?? "ogc",
  clientSecret: need("IIOS_MOCK_CLIENT_SECRET"),
});
const port = Number(process.env.PORT ?? 8790);
await app.listen({ host: process.env.HOST ?? "127.0.0.1", port });
console.log(
  `iios-mock listening on ${process.env.HOST ?? "127.0.0.1"}:${port} (synthetic, dev only)`,
);
