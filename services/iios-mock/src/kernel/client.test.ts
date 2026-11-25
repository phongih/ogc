// KernelDirectory (S3b, OGC-ADR-043) against a throwaway kernel: seed the synthetic directory
// plus a per-org signing key, then resolve each member's role + orgAdmin — staff/teacher/guardian
// unbound, learner via bind — and confirm non-members and tenant isolation.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import pg from "pg";
import { installKernel, dropKernel } from "./install.js";
import { KernelDirectory } from "./client.js";
// @ts-expect-error — shared .mjs helper (no type declarations)
import { DIRECTORY } from "../../../../ops/iios/gen-seed.mjs";

const SEED_SQL = readFileSync(fileURLToPath(new URL("../../../../ops/iios/seed-synthetic.sql", import.meta.url)), "utf8");
const ADMIN_URL = process.env.OGC_TEST_PG_ADMIN_URL ?? "";
if (!ADMIN_URL && process.env.CI) throw new Error("OGC_TEST_PG_ADMIN_URL is required in CI");

describe.skipIf(!ADMIN_URL)("KernelDirectory resolve (S3b)", () => {
  const dbName = "dak";
  const keyNova = crypto.randomBytes(32);
  const keyLumen = crypto.randomBytes(32);
  let admin: pg.Client;
  let dir: KernelDirectory;

  beforeAll(async () => {
    const installed = await installKernel(ADMIN_URL, dbName);
    const au = new URL(ADMIN_URL);
    au.pathname = `/${dbName}`;
    admin = new pg.Client({ connectionString: au.toString() });
    await admin.connect();
    await admin.query(SEED_SQL);
    // per-org signing keys (dev) that iios-mock holds and the kernel validates binds against
    const seedKey = (org: string, secret: Buffer) =>
      admin.query(
        `INSERT INTO authz.principal_keys (org_id, key_id, secret, not_before, not_after)
         VALUES ($1, 'k1', $2, now() - interval '1 hour', now() + interval '1 day')
         ON CONFLICT DO NOTHING`,
        [org, secret],
      );
    await seedKey(DIRECTORY.ORG_NOVA, keyNova);
    await seedKey(DIRECTORY.ORG_LUMEN, keyLumen);

    const host = au.hostname;
    const port = Number(au.port || 5432);
    dir = new KernelDirectory({
      host,
      port,
      database: dbName,
      orgs: new Map([
        [DIRECTORY.ORG_NOVA, { role: "iios_app_o_alpha", password: installed.passwords.iios_app_o_alpha, keyId: "k1", key: keyNova }],
        [DIRECTORY.ORG_LUMEN, { role: "iios_app_o_beta", password: installed.passwords.iios_app_o_beta, keyId: "k1", key: keyLumen }],
      ]),
    });
  }, 120_000);

  afterAll(async () => {
    await dir?.close();
    await admin?.end().catch(() => {});
    if (ADMIN_URL) await dropKernel(ADMIN_URL, dbName);
  });

  const N = DIRECTORY.ORG_NOVA;
  const L = DIRECTORY.ORG_LUMEN;

  it("admin → staff + orgAdmin", async () => {
    expect(await dir.resolve(N, "iios-principal-admin-1")).toEqual({ role: "staff", orgAdmin: true });
  });
  it("staff → staff, not admin", async () => {
    expect(await dir.resolve(N, "iios-principal-staff-1")).toEqual({ role: "staff", orgAdmin: false });
  });
  it("teacher → teacher", async () => {
    expect(await dir.resolve(N, "iios-principal-teacher-1")).toEqual({ role: "teacher", orgAdmin: false });
  });
  it("guardian → guardian", async () => {
    expect(await dir.resolve(N, "iios-principal-guardian-1")).toEqual({ role: "guardian", orgAdmin: false });
  });
  it("learner → learner (confirmed via bind)", async () => {
    expect(await dir.resolve(N, "iios-principal-learner-1")).toEqual({ role: "learner", orgAdmin: false });
    expect(await dir.resolve(N, "iios-principal-learner-2")).toEqual({ role: "learner", orgAdmin: false });
  });
  it("no-role member → null (not in the kernel)", async () => {
    expect(await dir.resolve(N, "iios-principal-norole-1")).toBeNull();
  });
  it("unknown principal → null", async () => {
    expect(await dir.resolve(N, "iios-principal-does-not-exist")).toBeNull();
  });
  it("tenant isolation: a NOVA-held principal does not resolve under LUMEN", async () => {
    expect(await dir.resolve(L, "iios-principal-teacher-1")).toBeNull();
    // LUMEN resolves its own members
    expect(await dir.resolve(L, "iios-principal-staff-org2")).toEqual({ role: "staff", orgAdmin: false });
    expect(await dir.resolve(L, "iios-principal-learner-org2")).toEqual({ role: "learner", orgAdmin: false });
  });
  it("unknown organization → null", async () => {
    expect(await dir.resolve("00000000-0000-4000-8000-0000000000ff", "iios-principal-admin-1")).toBeNull();
  });
});
