/*
 * Independently verify a built dist against its SHA-256 manifest.
 * Fail-closed: non-zero exit on invalid manifest, unexpected build mode, or any missing /
 * size-mismatched / hash-mismatched asset.
 * Usage: node verify-artifact.mjs <dist_dir> <manifest>
 */
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const [, , dist, manifestPath] = process.argv;
if (!dist || !manifestPath) {
  console.error("usage: verify-artifact.mjs <dist_dir> <manifest>");
  process.exit(2);
}
let m;
try {
  m = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error("invalid manifest: not parseable JSON");
  process.exit(1);
}
if (m?.schema !== "ogc-release-manifest/1") {
  console.error(`invalid manifest: unexpected schema ${m?.schema}`);
  process.exit(1);
}
if (m.buildMode !== "mock") {
  console.error(`rejected: unexpected build mode '${m.buildMode}' (only 'mock' is allowed)`);
  process.exit(1);
}
if (!Array.isArray(m.assets) || m.assets.length === 0) {
  console.error("invalid manifest: no assets");
  process.exit(1);
}
let problems = 0;
for (const a of m.assets) {
  if (!a || typeof a.path !== "string" || typeof a.sha256 !== "string" || typeof a.bytes !== "number") {
    console.error(`invalid asset entry: ${JSON.stringify(a)}`);
    problems++;
    continue;
  }
  const p = join(dist, a.path);
  if (!existsSync(p)) {
    console.error(`MISSING  ${a.path}`);
    problems++;
    continue;
  }
  const buf = readFileSync(p);
  if (buf.length !== a.bytes) {
    console.error(`SIZE MISMATCH  ${a.path} (have ${buf.length}, want ${a.bytes})`);
    problems++;
  }
  const h = createHash("sha256").update(buf).digest("hex");
  if (h !== a.sha256) {
    console.error(`SHA MISMATCH  ${a.path}`);
    problems++;
  }
}
if (!m.assets.some((a) => a.path === "index.html")) {
  console.error("manifest does not list index.html");
  problems++;
}
if (problems > 0) {
  console.error(`verify-artifact: FAILED (${problems} problem(s))`);
  process.exit(1);
}
console.log(`verify-artifact: OK — ${m.assets.length} assets match manifest (sha ${String(m.sha).slice(0, 7)})`);
