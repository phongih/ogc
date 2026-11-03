/*
 * OGC release toolkit tests (NON-PRODUCTION). Happy paths AND failure scenarios.
 * Run: node ops/release/test/release.test.mjs   (exit 0 = all passed)
 *
 * Scripts are invoked as real child processes against throwaway temp directories so the
 * fail-closed behavior (non-zero exit on bad input) is exercised exactly as in production.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = dirname(dirname(fileURLToPath(import.meta.url))); // ops/release
const REPO = dirname(dirname(SCRIPTS)); // repo root
const SHA = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

let pass = 0;
let fail = 0;
const tmps = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), "ogc-rel-"));
  tmps.push(d);
  return d;
}
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL  ${name} :: ${e.message}`);
    fail++;
  }
}
// Run a toolkit script; returns {code, stdout, stderr}. Never throws.
function run(script, args, env = {}) {
  try {
    const stdout = execFileSync("bash", [join(SCRIPTS, script), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout?.toString() ?? "", stderr: e.stderr?.toString() ?? "" };
  }
}
function expectOk(r, label) {
  if (r.code !== 0) throw new Error(`${label}: expected success, got code ${r.code} :: ${r.stderr.trim()}`);
}
function expectFail(r, label) {
  if (r.code === 0) throw new Error(`${label}: expected fail-closed non-zero exit, got success`);
}

// ─────────────────────────────── B-1: release-checkout ───────────────────────────────
check("checkout: snapshots the exact SHA into a fresh dest (non-destructive)", () => {
  const dest = join(tmp(), "snap");
  const before = execFileSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" });
  const r = run("release-checkout.sh", [REPO, SHA, dest]);
  expectOk(r, "checkout happy");
  if (!existsSync(join(dest, "package.json"))) throw new Error("snapshot missing package.json");
  const prov = readFileSync(join(dest, ".release-sha"), "utf8").trim();
  if (prov !== SHA) throw new Error(`.release-sha ${prov} != ${SHA}`);
  const after = execFileSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" });
  if (before !== after) throw new Error("source repo working tree changed (not non-destructive)");
});

check("checkout: rejects a non-existent commit", () => {
  const dest = join(tmp(), "snap");
  expectFail(run("release-checkout.sh", [REPO, "0".repeat(40), dest]), "missing commit");
  if (existsSync(join(dest, "package.json"))) throw new Error("left a partial snapshot");
});

check("checkout: rejects a short / non-hex sha", () => {
  expectFail(run("release-checkout.sh", [REPO, "deadbeef", join(tmp(), "s")]), "short sha");
  expectFail(run("release-checkout.sh", [REPO, "z".repeat(40), join(tmp(), "s")]), "non-hex sha");
});

check("checkout: rejects an unsafe (relative / ..) dest", () => {
  expectFail(run("release-checkout.sh", [REPO, SHA, "relative/dest"]), "relative dest");
  expectFail(run("release-checkout.sh", [REPO, SHA, "/tmp/../etc/dest"]), "dotdot dest");
});

check("checkout: refuses to overwrite an existing dest", () => {
  const dest = join(tmp(), "exists");
  mkdirSync(dest);
  writeFileSync(join(dest, "keep"), "x");
  expectFail(run("release-checkout.sh", [REPO, SHA, dest]), "existing dest");
});

// ───────────────────────────────────── summary ──────────────────────────────────────
for (const d of tmps) rmSync(d, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} release-toolkit checks passed`);
process.exit(fail === 0 ? 0 : 1);
