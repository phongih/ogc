/*
 * OGC backup script tests (ops/backup/ogc-backup.sh). Happy path AND failure scenarios, against a
 * fake GCS (create-only, refuses an existing name like ifGenerationMatch=0) and a fake metadata
 * token server; pg_dump / pg_restore are stubs. Run: node ops/backup/test/backup.test.mjs
 */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(dirname(fileURLToPath(import.meta.url))), "ogc-backup.sh");
const TOKEN = "ya29.test-token-never-printed";
let pass = 0;
let fail = 0;
const tmps = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "ogc-bak-"));
  tmps.push(d);
  return d;
};

// fake GCS: objects by name; `mode` makes it misbehave on purpose
const objects = new Map();
let mode = "ok";
const gcs = createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "no token" });
    const m = u.pathname.match(/^\/upload\/storage\/v1\/b\/([^/]+)\/o$/);
    if (req.method !== "POST" || !m || u.searchParams.get("uploadType") !== "media")
      return send(400, { error: "bad request" });
    if (u.searchParams.get("ifGenerationMatch") !== "0")
      return send(403, { error: "create-only: overwrite needs delete" });
    const name = `${m[1]}/${u.searchParams.get("name")}`;
    if (mode === "forbidden") return send(403, { error: "storage.objects.create denied" });
    if (objects.has(name)) return send(412, { error: "conditionNotMet" });
    objects.set(name, body);
    send(200, { name, size: String(mode === "short" ? body.length - 1 : body.length) });
  });
});
const meta = createServer((req, res) => {
  if (req.headers["metadata-flavor"] !== "Google" || mode === "notoken") {
    res.writeHead(403);
    return res.end("no");
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ access_token: TOKEN, expires_in: 3599, token_type: "Bearer" }));
});
await new Promise((r) => gcs.listen(0, "127.0.0.1", r));
await new Promise((r) => meta.listen(0, "127.0.0.1", r));

// stubs: pg_dump writes "PGDMP <db>" (or nothing for db "empty"); pg_restore --list rejects "BROKEN"
const bin = tmp();
writeFileSync(
  join(bin, "pg_dump"),
  '#!/usr/bin/env bash\n[ "$1" = -Fc ] || exit 9\n[ "$2" = empty ] && exit 0\n[ "$2" = broken ] && { echo BROKEN; exit 0; }\nprintf "PGDMP %s %s" "$2" "$(head -c 2000 /dev/urandom | base64 -w0)"\n',
);
writeFileSync(
  join(bin, "pg_restore"),
  '#!/usr/bin/env bash\n[ "$1" = --list ] || exit 9\ngrep -q "^PGDMP" "$2"\n',
);
chmodSync(join(bin, "pg_dump"), 0o755);
chmodSync(join(bin, "pg_restore"), 0o755);

function run(env) {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [SCRIPT],
      {
        env: {
          PATH: process.env.PATH,
          OGC_BACKUP_BUCKET: "ogc-backups-test",
          OGC_PG_DUMP: join(bin, "pg_dump"),
          OGC_PG_RESTORE: join(bin, "pg_restore"),
          OGC_GCS_URL: `http://127.0.0.1:${gcs.address().port}`,
          OGC_TOKEN_URL: `http://127.0.0.1:${meta.address().port}/token`,
          ...env,
        },
      },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}
async function check(name, fn) {
  mode = "ok";
  try {
    await fn();
    console.log(`PASS  ${name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL  ${name} :: ${e.message}`);
    fail++;
  }
}
const assert = (c, msg) => {
  if (!c) throw new Error(msg);
};
const files = (d) => readdirSync(d).filter((f) => !f.startsWith("."));

await check(
  "dumps both databases, root-only files, uploads them under <TS>/ with matching size",
  async () => {
    const dir = join(tmp(), "bk");
    objects.clear();
    const r = await run({ OGC_BACKUP_DIR: dir });
    assert(r.code === 0, `exit ${r.code}: ${r.out}`);
    const local = files(dir).sort();
    assert(local.length === 4, `local files: ${local}`); // 2 dumps + sha256 + last-ok
    assert(
      local.some((f) => /^ogc-\d{8}T\d{6}Z\.dump$/.test(f)) &&
        local.some((f) => /^iios_mock-.*\.dump$/.test(f)),
      `${local}`,
    );
    assert((statSync(dir).mode & 0o777) === 0o700, "dir not 700");
    for (const f of local) assert((statSync(join(dir, f)).mode & 0o777) === 0o600, `${f} not 600`);
    const up = [...objects.keys()];
    assert(
      up.length === 3 && up.every((n) => /^ogc-backups-test\/\d{8}T\d{6}Z\//.test(n)),
      `uploaded: ${up}`,
    );
    for (const [n, body] of objects)
      assert(readFileSync(join(dir, n.split("/").pop())).equals(body), `${n} differs`);
    const sums = readFileSync(
      join(
        dir,
        local.find((f) => f.endsWith(".sha256")),
      ),
      "utf8",
    );
    assert(
      sums.includes("ogc-") && sums.includes("iios_mock-") && !sums.includes(dir),
      "sha256 lists bare names",
    );
    assert(r.out.includes("[backup] ok ") && !r.out.includes(TOKEN), "ok line, token hidden");
    assert(
      readFileSync(join(dir, "last-ok"), "utf8").includes("gs://ogc-backups-test/"),
      "last-ok",
    );
  },
);

await check("an existing backup folder that is too open (755) becomes 700", async () => {
  const dir = join(tmp(), "bk");
  mkdirSync(dir, { mode: 0o755 });
  chmodSync(dir, 0o755);
  objects.clear();
  const r = await run({ OGC_BACKUP_DIR: dir });
  assert(r.code === 0, r.out);
  assert(
    (statSync(dir).mode & 0o777) === 0o700,
    `dir is ${(statSync(dir).mode & 0o777).toString(8)}`,
  );
});

await check("an existing object name is refused (412) → fails, nothing overwritten", async () => {
  const dir = join(tmp(), "bk");
  objects.clear();
  // same second twice: pre-create the names the script will use
  const r1 = await run({ OGC_BACKUP_DIR: dir });
  assert(r1.code === 0, r1.out);
  const before = new Map(objects);
  // replay: upload the same TS again by faking `date` on PATH
  const fake = tmp();
  const ts = [...objects.keys()][0].split("/")[1];
  writeFileSync(join(fake, "date"), `#!/usr/bin/env bash\necho ${ts}\n`);
  chmodSync(join(fake, "date"), 0o755);
  const r2 = await run({ OGC_BACKUP_DIR: join(tmp(), "bk2"), PATH: `${fake}:${process.env.PATH}` });
  assert(r2.code !== 0 && r2.out.includes("HTTP 412"), `expected 412 failure: ${r2.out}`);
  for (const [n, b] of before) assert(objects.get(n).equals(b), `${n} was overwritten`);
});

for (const [label, m, expect] of [
  ["the bucket refuses the service account (403)", "forbidden", "HTTP 403"],
  ["the stored size differs from the local file", "short", "stored size"],
  ["no access token from the metadata server", "notoken", "no access token"],
]) {
  await check(`${label} → fails closed`, async () => {
    objects.clear();
    mode = m;
    const r = await run({ OGC_BACKUP_DIR: join(tmp(), "bk") });
    assert(r.code !== 0 && r.out.includes("[backup][ERROR]") && r.out.includes(expect), r.out);
    assert(!r.out.includes(TOKEN), "token printed");
  });
}

await check("an empty or unreadable dump stops before any upload; no *.part left", async () => {
  for (const db of ["empty", "broken"]) {
    objects.clear();
    const dir = join(tmp(), "bk");
    const r = await run({ OGC_BACKUP_DIR: dir, OGC_BACKUP_DBS: `ogc ${db}` });
    assert(r.code !== 0 && /empty dump|cannot read/.test(r.out), `${db}: ${r.out}`);
    assert(objects.size === 0, `${db}: uploaded ${objects.size}`);
    assert(
      !files(dir).some((f) => f.endsWith(".part")) &&
        !readdirSync(dir).some((f) => f.startsWith(".work")),
      `${db}: leftovers`,
    );
  }
});

await check("bad settings are refused before anything runs", async () => {
  for (const env of [
    { OGC_BACKUP_BUCKET: "" },
    { OGC_BACKUP_BUCKET: "Bad Bucket" },
    { OGC_BACKUP_DIR: "relative/dir" },
    { OGC_BACKUP_DIR: "/" },
    { OGC_BACKUP_KEEP_DAYS: "0" },
    { OGC_BACKUP_KEEP_DAYS: "61" },
    { OGC_BACKUP_DBS: "ogc; rm -rf /" },
    { OGC_BACKUP_DBS: "ogc ogc-x" }, // harmless but not a database name: nothing is dumped or uploaded
  ]) {
    objects.clear();
    const r = await run({ OGC_BACKUP_DIR: join(tmp(), "bk"), ...env });
    assert(
      r.code !== 0 && r.out.includes("[backup][ERROR]") && objects.size === 0,
      `${JSON.stringify(env)}: ${r.out}`,
    );
  }
});

await check("keeps KEEP_DAYS of local copies (old names too); newer ones stay", async () => {
  const dir = join(tmp(), "bk");
  objects.clear();
  await run({ OGC_BACKUP_DIR: dir });
  const old = join(dir, "ogc-2026-11-01.dump");
  const recent = join(dir, "iios_mock-2026-11-23.dump");
  writeFileSync(old, "x");
  writeFileSync(recent, "x");
  const days = (n) => new Date(Date.now() - n * 86400_000);
  utimesSync(old, days(9), days(9));
  utimesSync(recent, days(2), days(2));
  objects.clear(); // both runs may fall in the same second: the same names would rightly be refused
  const r = await run({ OGC_BACKUP_DIR: dir, OGC_BACKUP_KEEP_DAYS: "7" });
  assert(r.code === 0, r.out);
  assert(!existsSync(old) && existsSync(recent), `old kept or recent removed: ${files(dir)}`);
  assert(r.out.includes("removed old local copy"), r.out);
});

gcs.close();
meta.close();
for (const d of tmps) rmSync(d, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
