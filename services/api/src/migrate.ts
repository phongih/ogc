/*
 * Migration runner (ADR-040 §4). Forward-only numbered `.sql` files in `migrations/`, each in its
 * own transaction, recorded with a SHA-256. A file that changed after it was applied stops the
 * run: migrations are never edited after merge. Runs as the migration (owner) role, never as
 * `ogc_app`.
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  already: string[];
}

export async function migrate(url: string, dir: string): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) if (!NAME.test(f)) throw new Error(`migrate: bad file name ${f}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const out: MigrationResult = { applied: [], already: [] };
  try {
    await client.query(`create table if not exists schema_migration (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);
    // One runner at a time.
    await client.query("select pg_advisory_lock(40480040)");
    const done = new Map(
      (
        await client.query<{ name: string; sha256: string }>(
          "select name, sha256 from schema_migration",
        )
      ).rows.map((r) => [r.name, r.sha256]),
    );
    for (const f of files) {
      const body = await readFile(join(dir, f), "utf8");
      const sha = createHash("sha256").update(body).digest("hex");
      const prev = done.get(f);
      if (prev) {
        if (prev !== sha) throw new Error(`migrate: ${f} changed after it was applied`);
        out.already.push(f);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(body);
        await client.query("insert into schema_migration (name, sha256) values ($1, $2)", [f, sha]);
        await client.query("commit");
      } catch (e) {
        await client.query("rollback");
        throw new Error(`migrate: ${f} failed: ${(e as Error).message}`);
      }
      out.applied.push(f);
    }
    for (const name of done.keys())
      if (!files.includes(name)) throw new Error(`migrate: ${name} was applied but is missing`);
  } finally {
    await client.end();
  }
  return out;
}

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

// CLI: DATABASE_URL_MIGRATE=… node dist/migrate.mjs [dir]
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_MIGRATE;
  if (!url)
    throw new Error("migrate: DATABASE_URL_MIGRATE is required (the owner role, not ogc_app)");
  const r = await migrate(url, process.argv[2] ?? MIGRATIONS_DIR);
  console.log(
    `migrate: applied ${r.applied.length} (${r.applied.join(", ") || "none"}), already ${r.already.length}`,
  );
}
