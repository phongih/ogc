// IIOS kernel install adapter — dev/test only.
//
// Stands up the vendored, reviewed kernel SQL (kernel/sql/, hashes in
// kernel/PROVENANCE.md) in a throwaway PostgreSQL database so CI can exercise the
// kernel's in-database invariants. This is NOT the production provisioning path.
//
// What it applies, and in the reviewed order: p01_schema → p01b_r2_person →
// p01c_r3_recovery, each of which does `SET ROLE iios_owner` … `RESET ROLE` so every
// object is owned by iios_owner and SECURITY DEFINER functions run as iios_owner (RLS
// is enforced, never bypassed), exactly as in the reviewed harness.
//
// Two deliberate, documented deviations from the reviewed p00_roles.sql, because a
// shared CI cluster is not a single-superuser `bootstrap` cluster:
//   1. Roles are created here (idempotent DROP … IF EXISTS first, parameterised
//      passwords) instead of executing p00's psql-variable form. The role names,
//      attributes and grants mirror p00 line-for-line.
//   2. p00's `CREATE DATABASE dak` and its `REVOKE ALL ON DATABASE postgres FROM
//      PUBLIC` are NOT run; the caller's throwaway database is created and owned by
//      iios_owner here, and CONNECT is granted on it instead of on `dak`.
//
// The cluster-level admission guard (p02_guard.sql) is vendored and hash-pinned but is
// NOT applied here: its OB1 check requires the only superuser to be `bootstrap`, which a
// managed CI cluster (superuser `postgres`) cannot satisfy. Applying and verifying the
// guard belongs to the Platform provisioning slice (see OGC-ADR-041 §Boundaries).
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import pg from "pg";

const SQL_DIR = fileURLToPath(new URL("../../kernel/sql", import.meta.url));

/** The five vendored kernel files, with the SHA-256 reviewed in PROVENANCE.md. */
export const KERNEL_FILES = {
  p00_roles: "86150043b0e875ec545892e26b3ae1dca3609ea18f876744ca727f74641c0869",
  p01_schema: "afd3d6cc414d8cd53244d816d58448485387c81e71bd5ed4f3a5162a4a11b137",
  p02_guard: "b738ddaae27f5ab79ecb3a757afcdd5d5f3d7da7f615d6a35c436b6cfdac9d75",
  p01b_r2_person: "ba7bda09b905ee6bc5f524eaa4fda393548712ae2807310ee68144270d0cd79a",
  p01c_r3_recovery: "fd8b921d2f5a2374693b77761c260159bf45fb356cc745a566c74bdf50e52406",
} as const;

export type KernelFile = keyof typeof KERNEL_FILES;

export function kernelSql(name: KernelFile): string {
  return readFileSync(`${SQL_DIR}/${name}.sql`, "utf8");
}

export function sha256(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** psql `\set …` meta-commands are client-side; strip them before sending to the server. */
function stripMeta(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^\s*\\/.test(line))
    .join("\n");
}

// Role names and attributes mirror the reviewed p00_roles.sql. Login roles get a
// per-install random password so the per-org sessions can connect over TCP (scram).
const LOGIN_ROLES = ["iios_app_o_alpha", "iios_app_o_beta", "iios_auditor", "iios_migrate", "iios_scheduler"] as const;

export interface InstalledKernel {
  dbName: string;
  orgRoles: { alpha: string; beta: string };
  passwords: Record<(typeof LOGIN_ROLES)[number], string>;
}

async function ensureRoles(admin: pg.Client): Promise<Record<(typeof LOGIN_ROLES)[number], string>> {
  const pw = Object.fromEntries(LOGIN_ROLES.map((r) => [r, crypto.randomBytes(18).toString("hex")])) as Record<
    (typeof LOGIN_ROLES)[number],
    string
  >;
  // Drop dependents first, then base roles — idempotent across reruns on a persistent cluster.
  await admin.query(
    `DROP ROLE IF EXISTS iios_app_o_alpha, iios_app_o_beta, iios_migrate, iios_scheduler, iios_auditor, iios_maint, iios_app, iios_owner`,
  );
  await admin.query(`CREATE ROLE iios_owner NOLOGIN`);
  await admin.query(`CREATE ROLE iios_app   NOLOGIN`);
  await admin.query(`CREATE ROLE iios_app_o_alpha LOGIN PASSWORD '${pw.iios_app_o_alpha}'`);
  await admin.query(`CREATE ROLE iios_app_o_beta  LOGIN PASSWORD '${pw.iios_app_o_beta}'`);
  await admin.query(`GRANT iios_app TO iios_app_o_alpha, iios_app_o_beta WITH INHERIT TRUE, SET FALSE, ADMIN FALSE`);
  await admin.query(`CREATE ROLE iios_auditor   LOGIN PASSWORD '${pw.iios_auditor}'`);
  await admin.query(`CREATE ROLE iios_migrate   LOGIN PASSWORD '${pw.iios_migrate}'`);
  await admin.query(`GRANT iios_owner TO iios_migrate WITH INHERIT FALSE, SET TRUE, ADMIN FALSE`);
  await admin.query(`CREATE ROLE iios_scheduler LOGIN PASSWORD '${pw.iios_scheduler}'`);
  await admin.query(`CREATE ROLE iios_maint     NOLOGIN`);
  await admin.query(`GRANT pg_read_all_stats TO iios_maint`);
  return pw;
}

/**
 * Install the kernel schema into a fresh database named `dbName`, reachable from
 * `adminUrl` (a superuser connection). Returns the org-login role credentials so the
 * caller can open per-organization sessions.
 */
// The reviewed p01_schema.sql hardcodes `REVOKE … ON DATABASE dak`, so the kernel can
// only install into a database named `dak`. We keep the parameter for clarity but require
// that name rather than rewrite the reviewed SQL.
export async function installKernel(adminUrl: string, dbName: string): Promise<InstalledKernel> {
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`unsafe db name: ${dbName}`);
  if (dbName !== "dak") throw new Error(`kernel installs into 'dak' (p01 hardcodes it); got ${dbName}`);
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  let pw: Record<(typeof LOGIN_ROLES)[number], string>;
  try {
    // Drop the database before the roles — iios_owner cannot be dropped while it owns dak.
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    pw = await ensureRoles(admin);
    await admin.query(`CREATE DATABASE ${dbName} OWNER iios_owner`);
    await admin.query(`REVOKE ALL ON DATABASE ${dbName} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${dbName} TO iios_app, iios_auditor, iios_migrate, iios_scheduler`);
  } finally {
    await admin.end();
  }

  const dbUrl = new URL(adminUrl);
  dbUrl.pathname = `/${dbName}`;
  const owner = new pg.Client({ connectionString: dbUrl.toString() });
  await owner.connect();
  try {
    for (const f of ["p01_schema", "p01b_r2_person", "p01c_r3_recovery"] as const) {
      await owner.query(stripMeta(kernelSql(f)));
    }
  } finally {
    await owner.end();
  }

  // Org identifiers are assigned by the fixture, not by install; the caller maps them.
  return { dbName, orgRoles: { alpha: "iios_app_o_alpha", beta: "iios_app_o_beta" }, passwords: pw };
}

/** Drop the throwaway database and the global kernel roles. Best-effort teardown. */
export async function dropKernel(adminUrl: string, dbName: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.query(
      `DROP ROLE IF EXISTS iios_app_o_alpha, iios_app_o_beta, iios_migrate, iios_scheduler, iios_auditor, iios_maint, iios_app, iios_owner`,
    );
  } finally {
    await admin.end();
  }
}
