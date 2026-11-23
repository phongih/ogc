/*
 * MOCK IIOS — PostgreSQL policy store (owner decision 23/11: the mock IIOS keeps policies in its own
 * database, `iios_mock`, so they survive restarts; OGC's database never holds them). Every write
 * runs in one transaction under a per-organization advisory lock: read state → pure operation →
 * persist its changes. History rows are append-only (trigger).
 */
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PolicyRule, PolicyVersion } from "@ogc/contracts";
import type { Change, OrgPolicies, PolicyRecord, PolicyStore } from "./policies.js";
import { MEMBERS } from "./seed.js";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Forward-only migrations with a SHA-256 each (same discipline as the OGC API's runner). */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) if (!NAME.test(f)) throw new Error(`iios-mock migrate: bad file ${f}`);
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query(`create table if not exists iios_schema_migration (
      name text primary key, sha256 text not null, applied_at timestamptz not null default now())`);
    await c.query("select pg_advisory_lock(40480041)");
    const done = new Map(
      (
        await c.query<{ name: string; sha256: string }>(
          "select name, sha256 from iios_schema_migration",
        )
      ).rows.map((r) => [r.name, r.sha256]),
    );
    for (const f of files) {
      const body = await readFile(join(dir, f), "utf8");
      const sha = createHash("sha256").update(body).digest("hex");
      if (done.has(f)) {
        if (done.get(f) !== sha)
          throw new Error(`iios-mock migrate: ${f} changed after it was applied`);
        continue;
      }
      await c.query("begin");
      try {
        await c.query(body);
        await c.query("insert into iios_schema_migration (name, sha256) values ($1, $2)", [f, sha]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw new Error(`iios-mock migrate: ${f} failed: ${(e as Error).message}`);
      }
      applied.push(f);
    }
  } finally {
    await c.query("select pg_advisory_unlock(40480041)").catch(() => undefined);
    c.release();
  }
  return applied;
}

/** Insert the seed policies that are not there yet (never overwrites an edited one). */
export async function seedIfMissing(pool: pg.Pool, seed: PolicyRecord[]): Promise<number> {
  const c = await pool.connect();
  let added = 0;
  try {
    await c.query("begin");
    for (const p of seed) {
      const r = await c.query(
        `insert into iios_policy (ref, org_id, name, description, status, rules, version, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (ref) do nothing returning ref`,
        [
          p.ref,
          p.orgId,
          p.name,
          p.description,
          p.status,
          JSON.stringify(p.rules),
          p.version,
          p.updatedAt,
        ],
      );
      if (r.rowCount) {
        added++;
        for (const h of p.history) await insertHistory(c, p.ref, h);
      }
    }
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
  return added;
}

const insertHistory = (c: pg.PoolClient, ref: string, h: PolicyVersion) =>
  c.query(
    `insert into iios_policy_history (ref, version, change, status, description, rules, changed_by, changed_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      ref,
      h.version,
      h.change,
      h.status,
      h.description,
      JSON.stringify(h.rules),
      h.changedBy,
      h.changedAt,
    ],
  );

interface PolicyRow {
  ref: string;
  org_id: string;
  name: string;
  description: string | null;
  status: "active" | "retired";
  rules: PolicyRule[];
  version: number;
  updated_at: Date;
}
interface HistoryRow {
  ref: string;
  version: number;
  change: PolicyVersion["change"];
  status: "active" | "retired";
  description: string | null;
  rules: PolicyRule[];
  changed_by: string;
  changed_at: Date;
}

async function load(c: pg.PoolClient, orgId: string): Promise<OrgPolicies> {
  const ps = (await c.query<PolicyRow>("select * from iios_policy where org_id = $1", [orgId]))
    .rows;
  const hs = (
    await c.query<HistoryRow>(
      `select h.* from iios_policy_history h join iios_policy p on p.ref = h.ref
        where p.org_id = $1 order by h.ref, h.version`,
      [orgId],
    )
  ).rows;
  const at = (
    await c.query<{ principal_id: string; policy_ref: string }>(
      "select principal_id, policy_ref from iios_attachment where org_id = $1",
      [orgId],
    )
  ).rows;
  return {
    policies: ps.map((p) => ({
      ref: p.ref,
      orgId: p.org_id,
      name: p.name,
      description: p.description,
      status: p.status,
      rules: p.rules,
      version: p.version,
      updatedAt: p.updated_at.toISOString(),
      history: hs
        .filter((h) => h.ref === p.ref)
        .map((h) => ({
          version: h.version,
          status: h.status,
          description: h.description,
          rules: h.rules,
          changedBy: h.changed_by,
          changedAt: h.changed_at.toISOString(),
          change: h.change,
        })),
    })),
    // only principals IIOS knows as members of this organization
    attachments: new Map(
      at
        .filter((a) => MEMBERS.some((m) => m.principalId === a.principal_id && m.orgId === orgId))
        .map((a) => [a.principal_id, a.policy_ref]),
    ),
  };
}

async function apply(c: pg.PoolClient, changes: Change[]): Promise<void> {
  for (const ch of changes) {
    if (ch.kind === "policy") {
      const p = ch.policy;
      await c.query(
        `insert into iios_policy (ref, org_id, name, description, status, rules, version, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (ref) do update set description = excluded.description, status = excluded.status,
           rules = excluded.rules, version = excluded.version, updated_at = excluded.updated_at`,
        [
          p.ref,
          p.orgId,
          p.name,
          p.description,
          p.status,
          JSON.stringify(p.rules),
          p.version,
          p.updatedAt,
        ],
      );
      await insertHistory(c, p.ref, ch.entry);
    } else if (ch.ref === null) {
      await c.query("delete from iios_attachment where principal_id = $1 and org_id = $2", [
        ch.principalId,
        ch.orgId,
      ]);
    } else {
      await c.query(
        `insert into iios_attachment (principal_id, org_id, policy_ref) values ($1, $2, $3)
         on conflict (principal_id) do update set org_id = excluded.org_id, policy_ref = excluded.policy_ref`,
        [ch.principalId, ch.orgId, ch.ref],
      );
    }
  }
}

export function pgStore(pool: pg.Pool): PolicyStore {
  return {
    async read(orgId) {
      const c = await pool.connect();
      try {
        return await load(c, orgId);
      } finally {
        c.release();
      }
    },
    async write(orgId, op) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query("select pg_advisory_xact_lock(hashtext('iios-policy:' || $1))", [orgId]);
        const { result, changes } = op(await load(c, orgId));
        await apply(c, changes);
        await c.query("commit");
        return result;
      } catch (e) {
        await c.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        c.release();
      }
    },
  };
}
