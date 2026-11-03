/*
 * OGC release toolkit tests (NON-PRODUCTION). Happy paths AND failure scenarios.
 * Run: node ops/release/test/release.test.mjs   (exit 0 = all passed)
 *
 * Scripts are invoked as real child processes against throwaway temp directories so the
 * fail-closed behavior (non-zero exit on bad input) is exercised exactly as in production.
 */
import { execFileSync, spawn } from "node:child_process";
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

// ────────────────────────── B-2: build-manifest / verify-artifact ───────────────────
function fakeDist() {
  const d = tmp();
  mkdirSync(join(d, "assets"), { recursive: true });
  writeFileSync(join(d, "index.html"), "<!doctype html><title>x</title><script src=/assets/app.js></script>");
  writeFileSync(join(d, "assets", "app.js"), "console.log('ogc')");
  return d;
}
function makeManifest(dist, sha = "a".repeat(40), mode = "mock") {
  const out = join(tmp(), "manifest.json");
  execFileSync("node", [join(SCRIPTS, "make-manifest.mjs"), dist, sha, mode, out], { stdio: "ignore" });
  return out;
}

check("verify-artifact: accepts a dist that matches its manifest", () => {
  const dist = fakeDist();
  const man = makeManifest(dist);
  expectOk(run("verify-artifact.sh", [dist, man]), "verify happy");
});

check("verify-artifact: rejects a tampered asset (sha mismatch)", () => {
  const dist = fakeDist();
  const man = makeManifest(dist);
  writeFileSync(join(dist, "assets", "app.js"), "console.log('tampered')");
  expectFail(run("verify-artifact.sh", [dist, man]), "tamper");
});

check("verify-artifact: rejects a missing asset", () => {
  const dist = fakeDist();
  const man = makeManifest(dist);
  rmSync(join(dist, "assets", "app.js"));
  expectFail(run("verify-artifact.sh", [dist, man]), "missing asset");
});

check("verify-artifact: rejects an invalid manifest and a non-mock build mode", () => {
  const dist = fakeDist();
  const bad = join(tmp(), "bad.json");
  writeFileSync(bad, "{ not valid json");
  expectFail(run("verify-artifact.sh", [dist, bad]), "invalid manifest");
  const httpMan = makeManifest(dist, "a".repeat(40), "http");
  expectFail(run("verify-artifact.sh", [dist, httpMan]), "non-mock build mode");
});

check("build-manifest: rejects an unexpected build mode (no build performed)", () => {
  expectFail(run("build-manifest.sh", [REPO, join(tmp(), "m.json")], { OGC_BUILD_MODE: "http" }), "bad mode");
});

check("build-manifest: builds the synthetic SPA and the manifest verifies", () => {
  const man = join(tmp(), "release-manifest.json");
  expectOk(run("build-manifest.sh", [REPO, man]), "build-manifest happy");
  const m = JSON.parse(readFileSync(man, "utf8"));
  if (m.buildMode !== "mock") throw new Error(`buildMode ${m.buildMode}`);
  if (m.sha !== SHA) throw new Error(`manifest sha ${m.sha} != ${SHA}`);
  if (!m.assets.some((a) => a.path === "index.html")) throw new Error("no index.html in manifest");
  expectOk(run("verify-artifact.sh", [join(REPO, "apps/web/dist"), man]), "verify built artifact");
});

// ─────────────────────────────────── B-3: verify-https ──────────────────────────────
function makeCert() {
  const dir = tmp();
  const key = join(dir, "key.pem");
  const cert = join(dir, "cert.pem");
  execFileSync(
    "openssl",
    ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
     "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"],
    { stdio: "ignore" },
  );
  return { key, cert };
}

// The TLS server runs in a SEPARATE process: the test uses synchronous execFileSync for
// curl, which would otherwise block an in-process server's event loop.
const SERVER_SRC = `
const https = require("node:https"), fs = require("node:fs");
const s = https.createServer(
  { key: fs.readFileSync(process.argv[1]), cert: fs.readFileSync(process.argv[2]) },
  (req, res) => {
    if ((req.url || "/") === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(req.method === "HEAD" ? undefined : "<html><body>assets/app.js</body></html>");
    } else { res.writeHead(404); res.end(); }
  },
);
s.listen(0, "127.0.0.1", () => process.stdout.write("PORT=" + s.address().port + "\\n"));
`;

await (async () => {
  const cert = makeCert();
  const child = spawn("node", ["-e", SERVER_SRC, cert.key, cert.cert], { stdio: ["ignore", "pipe", "ignore"] });
  const port = await new Promise((resolve, reject) => {
    let buf = "";
    child.stdout.on("data", (d) => {
      buf += d;
      const m = buf.match(/PORT=(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.on("exit", () => reject(new Error("tls server exited early")));
    setTimeout(() => reject(new Error("tls server start timeout")), 5000);
  });
  const base = `https://127.0.0.1:${port}`;
  // The container routes outbound HTTPS through an agent proxy that cannot reach this
  // in-process localhost server; clear proxy vars for these local curls (production VMs
  // have no proxy, so verify-https.sh itself needs no proxy handling).
  const noProxy = {
    no_proxy: "localhost,127.0.0.1",
    NO_PROXY: "localhost,127.0.0.1",
    HTTPS_PROXY: "",
    https_proxy: "",
    HTTP_PROXY: "",
    http_proxy: "",
    ALL_PROXY: "",
    all_proxy: "",
  };
  const trusted = { ...noProxy, OGC_CACERT: cert.cert };
  try {
    check("verify-https: accepts HTTP 200 over a validated cert with the expected asset", () => {
      expectOk(run("verify-https.sh", [`${base}/`, "assets/app.js"], trusted), "https happy");
    });
    check("verify-https: fails when the cert is not trusted (never disables checks)", () => {
      expectFail(run("verify-https.sh", [`${base}/`, "assets/app.js"], noProxy), "untrusted cert");
    });
    check("verify-https: fails on a non-200 response", () => {
      expectFail(run("verify-https.sh", [`${base}/missing`, "assets/app.js"], trusted), "404");
    });
    check("verify-https: fails when the expected asset is absent", () => {
      expectFail(run("verify-https.sh", [`${base}/`, "no-such-asset"], trusted), "missing asset");
    });
    check("verify-https: refuses a non-HTTPS url", () => {
      expectFail(run("verify-https.sh", ["http://localhost:1/"], trusted), "http refused");
    });
  } finally {
    child.kill();
  }
})();

// ───────────────────────────────────── summary ──────────────────────────────────────
for (const d of tmps) rmSync(d, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} release-toolkit checks passed`);
process.exit(fail === 0 ? 0 : 1);
