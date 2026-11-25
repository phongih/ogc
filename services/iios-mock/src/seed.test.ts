// Synthetic directory on the IIOS kernel (S3a, OGC-ADR-042). Applies ops/iios/seed-synthetic.sql
// to a throwaway kernel and proves the resolve-time derivation an org session performs WITHOUT
// binding: orgAdmin from an org.admin grant, and role for staff/teacher/guardian from the grant
// table a principal appears in. Learner identity + the bind-confirmed type come in S3b (iios-mock
// holds the org key and binds); an org session cannot read learner/principal rows unbound, which
// this test documents.
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { installKernel, dropKernel } from "./kernel/install.js";
// @ts-expect-error — plain .mjs helper shared with the seed generator (no types)
import { uuid5, DIRECTORY } from "../../../ops/iios/gen-seed.mjs";

const SEED_SQL = readFileSync(fileURLToPath(new URL("../../../ops/iios/seed-synthetic.sql", import.meta.url)), "utf8");
const ADMIN_URL = process.env.OGC_TEST_PG_ADMIN_URL ?? "";
if (!ADMIN_URL && process.env.CI) throw new Error("OGC_TEST_PG_ADMIN_URL is required in CI");

// The canonical resolve-time derivation (what S3b's iios-mock runs as iios_app_o_<org>, unbound,
// org_sel-scoped). Keep this query in sync with the S3b kernel client.
const DERIVE = `
  SELECT
    EXISTS(SELECT 1 FROM authz.staff_center_grants g
            WHERE g.staff_id = $1 AND g.capability = 'org.admin'
              AND now() >= g.valid_from AND (g.valid_to IS NULL OR now() < g.valid_to)) AS org_admin,
    CASE
      WHEN EXISTS(SELECT 1 FROM authz.staff_center_grants g WHERE g.staff_id = $1) THEN 'staff'
      WHEN EXISTS(SELECT 1 FROM authz.class_assignments a WHERE a.teacher_id = $1) THEN 'teacher'
      WHEN EXISTS(SELECT 1 FROM authz.guardian_links l WHERE l.guardian_id = $1 AND l.revoked_at IS NULL) THEN 'guardian'
      ELSE NULL
    END AS role`;

describe.skipIf(!ADMIN_URL)("synthetic directory on the kernel (S3a)", () => {
  const dbName = "dak";
  let admin: pg.Client; // superuser on dak — applies the seed, reads for documentation
  let nova: pg.Client; //  iios_app_o_alpha → organization NOVA
  let lumen: pg.Client; // iios_app_o_beta  → organization LUMEN

  const kid = (sub: string) => uuid5(sub) as string;
  const derive = async (c: pg.Client, sub: string) => {
    const r = await c.query(DERIVE, [kid(sub)]);
    return { orgAdmin: r.rows[0].org_admin as boolean, role: r.rows[0].role as string | null };
  };

  beforeAll(async () => {
    const installed = await installKernel(ADMIN_URL, dbName);
    const au = new URL(ADMIN_URL);
    au.pathname = `/${dbName}`;
    admin = new pg.Client({ connectionString: au.toString() });
    await admin.connect();
    await admin.query(SEED_SQL); // BEGIN…COMMIT, literals only

    const orgClient = (role: "alpha" | "beta", pw: string) => {
      const u = new URL(ADMIN_URL);
      u.pathname = `/${dbName}`;
      u.username = role === "alpha" ? "iios_app_o_alpha" : "iios_app_o_beta";
      u.password = pw;
      return new pg.Client({ connectionString: u.toString() });
    };
    nova = orgClient("alpha", installed.passwords.iios_app_o_alpha);
    lumen = orgClient("beta", installed.passwords.iios_app_o_beta);
    await nova.connect();
    await lumen.connect();
  }, 120_000);

  afterAll(async () => {
    await nova?.end().catch(() => {});
    await lumen?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (ADMIN_URL) await dropKernel(ADMIN_URL, dbName);
  });

  it("org admin: the admin member resolves orgAdmin=true, role=staff", async () => {
    expect(await derive(nova, "iios-principal-admin-1")).toEqual({ orgAdmin: true, role: "staff" });
  });

  it("plain staff: resolves role=staff, orgAdmin=false", async () => {
    expect(await derive(nova, "iios-principal-staff-1")).toEqual({ orgAdmin: false, role: "staff" });
  });

  it("teacher: resolves role=teacher, orgAdmin=false", async () => {
    expect(await derive(nova, "iios-principal-teacher-1")).toEqual({ orgAdmin: false, role: "teacher" });
    expect(await derive(nova, "iios-principal-teacher-2")).toEqual({ orgAdmin: false, role: "teacher" });
  });

  it("guardian: resolves role=guardian, orgAdmin=false", async () => {
    expect(await derive(nova, "iios-principal-guardian-1")).toEqual({ orgAdmin: false, role: "guardian" });
  });

  it("tenant isolation: a NOVA session cannot see a LUMEN principal", async () => {
    expect(await derive(nova, "iios-principal-staff-org2")).toEqual({ orgAdmin: false, role: null });
    // …and the LUMEN session resolves its own staff
    expect(await derive(lumen, "iios-principal-staff-org2")).toEqual({ orgAdmin: false, role: "staff" });
  });

  it("learner is seeded but not unbound-derivable (confirmed via bind in S3b)", async () => {
    // An org session cannot read learner rows unbound, so the unbound derivation yields null…
    expect(await derive(nova, "iios-principal-learner-1")).toEqual({ orgAdmin: false, role: null });
    // …yet the learner principal is present in the kernel (read here as superuser).
    const r = await admin.query(
      "SELECT principal_type FROM authz.principals WHERE org_id = $1 AND principal_id = $2",
      [DIRECTORY.ORG_NOVA, kid("iios-principal-learner-1")],
    );
    expect(r.rows[0]?.principal_type).toBe("learner");
  });

  it("the no-role member is intentionally absent from the kernel", async () => {
    const r = await admin.query("SELECT count(*)::int n FROM authz.principals WHERE label = $1", [
      "iios-principal-norole-1",
    ]);
    expect(r.rows[0].n).toBe(0);
  });
});
