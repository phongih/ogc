/*
 * Emit a SHA-256 release manifest for a built dist tree.
 * Usage: node make-manifest.mjs <dist_dir> <40-hex-sha> <buildMode> <out_manifest>
 */
import { createHash } from "node:crypto";
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const [, , distDir, sha, buildMode, out] = process.argv;
if (!distDir || !sha || !buildMode || !out) {
  console.error("usage: make-manifest.mjs <dist_dir> <sha> <buildMode> <out_manifest>");
  process.exit(2);
}
function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) files.push(...walk(p));
    else if (st.isFile()) files.push(p);
  }
  return files;
}
const assets = walk(distDir)
  .sort()
  .map((f) => {
    const buf = readFileSync(f);
    return {
      path: relative(distDir, f),
      sha256: createHash("sha256").update(buf).digest("hex"),
      bytes: buf.length,
    };
  });
if (!assets.some((a) => a.path === "index.html")) {
  console.error("dist missing index.html — refusing to write a manifest");
  process.exit(1);
}
const manifest = {
  schema: "ogc-release-manifest/1",
  sha,
  buildMode,
  builtAt: new Date().toISOString(),
  assetCount: assets.length,
  totalBytes: assets.reduce((s, a) => s + a.bytes, 0),
  assets,
};
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`manifest: ${assets.length} assets, ${manifest.totalBytes} bytes, sha ${sha.slice(0, 7)} -> ${out}`);
