// IIOS kernel — vendored r1–r3 kernel installs in a throwaway PostgreSQL and enforces
// its in-database invariants. See OGC-ADR-041. Synthetic data only.
//
// Layers proved here (environment-independent, no cluster admission guard needed):
//   • provenance — the vendored SQL is byte-identical to the reviewed kernel
//   • sealed principal — valid bind resolves; forged MAC and absent bind are rejected
//   • fail-closed reads — learner tables are unreadable without a bound principal
//   • authorization read — a bound teacher sees only its assigned learners (tenant-correct)
//   • tenant anchor — session role maps to exactly one organization
//   • D-14 / C14 — guardian self-verification is prohibited; unknown identity fails closed;
//                   a different natural person may verify; identity tables are owner-only
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { KERNEL_FILES, sha256, installKernel, dropKernel } from "./kernel/install.js";
import { makeFixture, loadFixture, uuid, type Fixture, type Principal } from "./kernel/fixture.js";

const SQL_DIR = fileURLToPath(new URL("../kernel/sql", import.meta.url));
const nowS = () => Math.floor(Date.now() / 1000);

// ── provenance gate: runs with or without a database ────────────────────────────────
describe("kernel provenance", () => {
  it("vendored SQL is byte-identical to the reviewed kernel", () => {
    for (const [name, expected] of Object.entries(KERNEL_FILES)) {
      const actual = sha256(readFileSync(`${SQL_DIR}/${name}.sql`, "utf8"));
      expect(actual, `${name}.sql`).toBe(expected);
    }
  });
});

const ADMIN_URL = process.env.OGC_TEST_PG_ADMIN_URL ?? "";
if (!ADMIN_URL && process.env.CI) throw new Error("OGC_TEST_PG_ADMIN_URL is required in CI");

describe.skipIf(!ADMIN_URL)("kernel invariants on PostgreSQL", () => {
  // Fixed name `dak`: the reviewed p01_schema.sql hardcodes `REVOKE … ON DATABASE dak`,
  // so the kernel installs into a database of exactly that name (dropped/recreated per run).
  const dbName = "dak";
  const X: Fixture = makeFixture();
  const { F, KEYS, P, LBL } = X;
  // persons seeded for the C14 fixture (mirrors the reviewed r2 person fixture)
  const P1 = uuid();
  const P2 = uuid();

  let admin: pg.Client; // superuser, connected to dbName — seeds fixture, bypasses RLS
  let alpha: pg.Client; // session role iios_app_o_alpha (organization alpha)
  let beta: pg.Client; //  session role iios_app_o_beta  (organization beta)

  const mac = (keyName: string, f: Record<string, unknown>) =>
    crypto
      .createHmac("sha256", KEYS[keyName])
      .update(["v1", f.org, f.type, f.id, f.purpose, f.center ?? "-", f.req, f.pid, f.x, f.exp].join("|"), "utf8")
      .digest();

  // bind a principal inside the current transaction of client `c` for organization `org`
  async function bindAs(c: pg.Client, org: string, keyName: string, p: Principal): Promise<void> {
    const { rows } = await c.query("SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS x");
    const { pid, x } = rows[0] as { pid: number; x: string };
    const f = { org, type: p.type, id: p.id, purpose: p.purpose, center: p.center ?? null, req: uuid(), pid, x, exp: nowS() + 30 };
    await c.query("SELECT authz.bind_principal($1,$2,$3,$4,$5,$6,$7,$8)", [
      f.type, f.id, f.purpose, f.center, f.req, f.exp, keyName, mac(keyName, f),
    ]);
  }

  // run fn inside a BEGIN/ROLLBACK transaction (binds never leak between cases)
  async function tx<T>(c: pg.Client, fn: () => Promise<T>): Promise<T> {
    await c.query("BEGIN");
    try {
      const r = await fn();
      await c.query("ROLLBACK");
      return r;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    }
  }

  const errMsg = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return "";
    } catch (e) {
      return (e as Error).message;
    }
  };

  function orgClient(role: "alpha" | "beta", password: string): pg.Client {
    const u = new URL(ADMIN_URL);
    u.pathname = `/${dbName}`;
    u.username = role === "alpha" ? "iios_app_o_alpha" : "iios_app_o_beta";
    u.password = password;
    return new pg.Client({ connectionString: u.toString() });
  }

  beforeAll(async () => {
    const installed = await installKernel(ADMIN_URL, dbName);

    const au = new URL(ADMIN_URL);
    au.pathname = `/${dbName}`;
    admin = new pg.Client({ connectionString: au.toString() });
    await admin.connect();

    await loadFixture(admin, X);

    // r2 person fixture — owner-written (superuser bypasses RLS)
    await admin.query("BEGIN");
    await admin.query(`INSERT INTO authz.persons (org_id, person_id, source) VALUES ($1,$2,'ceremony'),($1,$3,'ceremony')`, [F.alpha, P1, P2]);
    const link = (prin: string, person: string) =>
      admin.query(`INSERT INTO authz.principal_persons (org_id, principal_id, person_id, linked_by, linked_at) VALUES ($1,$2,$3,$4, now())`, [F.alpha, F[prin], person, F.SA]);
    await link("SV", P1); // verifying staff → person P1
    await link("G6", P1); // guardian that is the SAME natural person as SV
    await link("G2", P2); // guardian that is a DIFFERENT natural person
    await link("G1", P2);
    await link("G4", P2);
    // G3 and S3 intentionally unlinked (identity unknown, fail-closed)
    await admin.query(`INSERT INTO authz.staff_center_grants (org_id, staff_id, center_id, capability, catalog_version, valid_from) VALUES ($1,$2,NULL,'guardian.verify','cat-2', now() - interval '10 days')`, [F.alpha, F.S3]);
    await admin.query("COMMIT");

    alpha = orgClient("alpha", installed.passwords.iios_app_o_alpha);
    beta = orgClient("beta", installed.passwords.iios_app_o_beta);
    await alpha.connect();
    await beta.connect();
  }, 120_000);

  afterAll(async () => {
    await alpha?.end().catch(() => {});
    await beta?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (ADMIN_URL) await dropKernel(ADMIN_URL, dbName);
  });

  it("installs clean: privileged functions and FORCE-RLS tables are present", async () => {
    const fns = await admin.query(
      `SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'authz' AND p.proname IN ('bind_principal','current_principal','verify_guardian_link')`,
    );
    expect(fns.rows[0].n).toBe(3);
    const rls = await admin.query(`SELECT count(*)::int n FROM pg_class WHERE relrowsecurity AND relforcerowsecurity`);
    expect(Number(rls.rows[0].n)).toBeGreaterThanOrEqual(20);
  });

  it("sealed principal: a valid bind resolves to the bound identity", async () => {
    const id = await tx(alpha, async () => {
      await bindAs(alpha, F.alpha, "k1", P.T1);
      const r = await alpha.query("SELECT (authz.current_principal()).principal_id AS id");
      return r.rows[0].id;
    });
    expect(id).toBe(F.T1);
  });

  it("sealed principal: a forged MAC is rejected (AZ_BIND_MAC)", async () => {
    const m = await errMsg(() =>
      tx(alpha, async () => {
        await alpha.query("SELECT authz.bind_principal($1,$2,$3,$4,$5,$6,$7,$8)", [
          P.T1.type, P.T1.id, P.T1.purpose, null, uuid(), nowS() + 30, "k1", crypto.randomBytes(32),
        ]);
      }),
    );
    expect(m).toBe("AZ_BIND_MAC");
  });

  it("sealed principal: current_principal without a bind fails (AZ_NO_PRINCIPAL)", async () => {
    const m = await errMsg(() => tx(alpha, async () => { await alpha.query("SELECT authz.current_principal()"); }));
    expect(m).toBe("AZ_NO_PRINCIPAL");
  });

  it("fail-closed: learner tables are unreadable without a bound principal", async () => {
    const m = await errMsg(() => tx(alpha, async () => { await alpha.query("SELECT count(*) FROM app.learners"); }));
    expect(m).toBe("AZ_NO_PRINCIPAL");
  });

  it("authorization read: a bound teacher sees only its assigned learners (no cross-tenant)", async () => {
    const got = await tx(alpha, async () => {
      await bindAs(alpha, F.alpha, "k1", P.T1);
      const { rows } = await alpha.query("SELECT learner_id, class_id FROM app.learning_evidence");
      return rows.map((r) => LBL.get(r.learner_id as string)! + LBL.get(r.class_id as string)!).sort().join(",");
    });
    expect(got).toBe("L1K1,L2K1");
  });

  it("tenant anchor: each session role maps to exactly one organization", async () => {
    const ra = await alpha.query("SELECT iios.org_of_session() AS o");
    const rb = await beta.query("SELECT iios.org_of_session() AS o");
    expect(ra.rows[0].o).toBe(F.alpha);
    expect(rb.rows[0].o).toBe(F.beta);
  });

  it("C14: guardian self-verification by the same natural person is prohibited (AZ_SELF_VERIFY)", async () => {
    const m = await errMsg(() =>
      tx(alpha, async () => {
        await bindAs(alpha, F.alpha, "k1", P.SV);
        await alpha.query("SELECT authz.verify_guardian_link($1,$2,$3)", [F.G6, F.L3, "synthetic-doc"]);
      }),
    );
    expect(m).toBe("AZ_SELF_VERIFY");
  });

  it("C14: unknown identity fails closed (AZ_IDENTITY_UNKNOWN)", async () => {
    const m = await errMsg(() =>
      tx(alpha, async () => {
        await bindAs(alpha, F.alpha, "k1", P.SV);
        await alpha.query("SELECT authz.verify_guardian_link($1,$2,$3)", [F.G3, F.L3, "synthetic-doc"]);
      }),
    );
    expect(m).toBe("AZ_IDENTITY_UNKNOWN");
  });

  it("C14: a different natural person may verify", async () => {
    const id = await tx(alpha, async () => {
      await bindAs(alpha, F.alpha, "k1", P.SV);
      const r = await alpha.query("SELECT authz.verify_guardian_link($1,$2,$3) AS id", [F.G2, F.L3, "synthetic-doc"]);
      return r.rows[0].id;
    });
    expect(id).toBeTruthy();
  });

  it("C14: identity tables are owner-only — runtime cannot read principal_persons", async () => {
    const m = await errMsg(() =>
      tx(alpha, async () => {
        await bindAs(alpha, F.alpha, "k1", P.SV);
        await alpha.query("SELECT person_id FROM authz.principal_persons LIMIT 1");
      }),
    );
    expect(m).toMatch(/permission denied/i);
  });
});
