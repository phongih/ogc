#!/usr/bin/env node
/*
 * ADR-040 §5 build-time guard: the two web builds must not leak into each other.
 *
 *   node ops/release/check-bundle.mjs platform <dir>   # Platform build (dist-platform)
 *   node ops/release/check-bundle.mjs demo <dir>       # Demo build (dist)
 *
 * platform: no demo mock adapter, synthetic persona or browser-storage fixture may be in it.
 * demo:     the demo never calls the Platform dev sign-in (it has its own mock personas).
 * Exit 0 = clean; 1 = a forbidden marker was found (each hit is printed); 2 = bad usage.
 * Markers are string literals (they survive minification), not identifiers.
 * Text files only (.js .mjs .css .html .json .map); every file under <dir> is scanned.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const FORBIDDEN = {
  platform: [
    // demo personas (mock sign-in)
    "demo-teacher",
    "demo-learner",
    "demo-staff",
    "demo-guardian",
    "demo-admin",
    // demo browser persistence of mock state
    "ogc.demo",
    "registerPersistent",
  ],
  demo: ["/v1/dev/login", "/v1/dev/personas"],
};

const TEXT = /\.(m?js|css|html|json|map)$/;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (TEXT.test(name)) yield p;
  }
}

export function scan(kind, dir) {
  const markers = FORBIDDEN[kind];
  if (!markers) throw new Error(`unknown kind: ${kind}`);
  const hits = [];
  let scanned = 0;
  for (const f of files(dir)) {
    scanned++;
    const text = readFileSync(f, "utf8");
    for (const m of markers) if (text.includes(m)) hits.push({ file: relative(dir, f), marker: m });
  }
  return { scanned, hits };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [kind, dir] = process.argv.slice(2);
  if (!kind || !dir || !FORBIDDEN[kind]) {
    console.error("usage: check-bundle.mjs <platform|demo> <dir>");
    process.exit(2);
  }
  let r;
  try {
    r = scan(kind, dir);
  } catch (e) {
    console.error(`check-bundle: ${e.message}`);
    process.exit(2);
  }
  if (r.scanned === 0) {
    console.error(`check-bundle: no files in ${dir}`);
    process.exit(2);
  }
  if (r.hits.length) {
    for (const h of r.hits) console.error(`FORBIDDEN in ${kind} build: "${h.marker}" in ${h.file}`);
    process.exit(1);
  }
  console.log(`check-bundle ${kind}: clean (${r.scanned} files)`);
}
