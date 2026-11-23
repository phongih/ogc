/*
 * Test database harness: a fresh database per test file on a real PostgreSQL, the migration owner
 * role and the `ogc_app` application role exactly as on the VM (app is not the owner, no
 * BYPASSRLS). Needs OGC_TEST_PG_ADMIN_URL (a superuser URL used only to create roles and the
 * database). Without it the tests are skipped locally and FAIL in CI.
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { connect, type Db } from "../db.js";
import { migrate, MIGRATIONS_DIR } from "../migrate.js";

export const ADMIN_URL = process.env.OGC_TEST_PG_ADMIN_URL ?? "";
if (!ADMIN_URL && process.env.CI)
  throw new Error("OGC_TEST_PG_ADMIN_URL is required in CI — backend tests must not be skipped");
export const hasPg = !!ADMIN_URL;

const APP_PW = "ogc_app_test_only";
const OWNER_PW = "ogc_owner_test_only";

function withDb(url: string, db: string, user?: string, pw?: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user;
    u.password = pw ?? "";
  }
  return u.toString();
}

export interface TestDb {
  name: string;
  ownerUrl: string;
  appUrl: string;
  app: Db; // connected as ogc_app
  drop(): Promise<void>;
}

export async function freshDb(): Promise<TestDb> {
  const name = `ogc_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  for (const [role, pw] of [
    ["ogc_owner", OWNER_PW],
    ["ogc_app", APP_PW],
  ] as const) {
    const exists = await admin.query("select 1 from pg_roles where rolname = $1", [role]);
    if (exists.rowCount === 0)
      await admin.query(`create role ${role} login password '${pw}' nosuperuser nobypassrls`);
  }
  await admin.query(`create database ${name} owner ogc_owner`);
  await admin.end();
  const ownerUrl = withDb(ADMIN_URL, name, "ogc_owner", OWNER_PW);
  const appUrl = withDb(ADMIN_URL, name, "ogc_app", APP_PW);
  await migrate(ownerUrl, MIGRATIONS_DIR);
  const app = connect(appUrl, 4);
  return {
    name,
    ownerUrl,
    appUrl,
    app,
    async drop() {
      await app.destroy();
      const a = new pg.Client({ connectionString: ADMIN_URL });
      await a.connect();
      await a.query(`drop database if exists ${name} with (force)`);
      await a.end();
    },
  };
}
