// Kernel directory client (S3b, OGC-ADR-043). iios-mock, as the IIOS authority, resolves a
// principal's role and orgAdmin from the kernel cluster. Synthetic/dev only.
//
// Two paths, matching what the kernel exposes to an org session (iios_app_o_<org>):
//   • unbound — read staff_center_grants / class_assignments / guardian_links (org_sel RLS,
//     no bind): orgAdmin from an active org.admin grant; role for staff / teacher / guardian.
//   • bind — learner identity and the bind-confirmed type are not readable unbound, so confirm
//     them with authz.bind_principal using the per-org signing key this service holds
//     (bind verifies the claimed (type,id) against authz.principals; AZ_BIND_PRINCIPAL = absent).
import crypto from "node:crypto";
import pg from "pg";
// @ts-expect-error — shared .mjs helper (no type declarations); keep uuid derivation identical.
import { uuid5 } from "../../../../ops/iios/gen-seed.mjs";

export type KernelRole = "staff" | "teacher" | "guardian" | "learner";
export interface ResolvedMember {
  role: KernelRole;
  orgAdmin: boolean;
}

/** What iios-mock's resolve needs from the kernel. KernelDirectory is the real implementation;
 *  tests may pass a stub. */
export interface KernelResolver {
  resolve(orgId: string, principalSub: string): Promise<ResolvedMember | null>;
}

export interface KernelOrg {
  role: string; // kernel org-login role, e.g. iios_app_o_alpha
  password: string;
  keyId: string; // authz.principal_keys key_id this service signs with
  key: Buffer; // 32-byte per-org signing key (dev)
}

export interface KernelDirectoryConfig {
  host: string;
  port: number;
  database?: string; // default 'dak'
  /** mock organization id → kernel org connection. */
  orgs: Map<string, KernelOrg>;
  purpose?: string; // bind purpose; default 'ogc.platform'
}

// The unbound derivation. Must stay in sync with services/iios-mock/src/seed.test.ts.
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

export class KernelDirectory implements KernelResolver {
  private readonly pools = new Map<string, pg.Pool>();
  private readonly purpose: string;

  constructor(private readonly cfg: KernelDirectoryConfig) {
    this.purpose = cfg.purpose ?? "ogc.platform";
  }

  private pool(org: KernelOrg): pg.Pool {
    let p = this.pools.get(org.role);
    if (!p) {
      p = new pg.Pool({
        host: this.cfg.host,
        port: this.cfg.port,
        database: this.cfg.database ?? "dak",
        user: org.role,
        password: org.password,
        max: 3,
      });
      p.on("error", () => {});
      this.pools.set(org.role, p);
    }
    return p;
  }

  /** Resolve role + orgAdmin for a mock principal id, or null if not a member of the org. */
  async resolve(orgId: string, principalSub: string): Promise<ResolvedMember | null> {
    const org = this.cfg.orgs.get(orgId);
    if (!org) return null;
    const pid = uuid5(principalSub) as string;
    const pool = this.pool(org);
    const r = await pool.query(DERIVE, [pid]);
    const orgAdmin = r.rows[0].org_admin === true;
    const role = r.rows[0].role as KernelRole | null;
    if (role) return { role, orgAdmin };
    // Not in the unbound-readable tables → confirm learner identity via bind.
    if (await this.bindConfirms(pool, org, "learner", pid)) return { role: "learner", orgAdmin: false };
    return null;
  }

  // True iff binding (type, pid) succeeds — i.e. the kernel holds that principal with that type.
  private async bindConfirms(pool: pg.Pool, org: KernelOrg, type: KernelRole, pid: string): Promise<boolean> {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const s = await c.query("SELECT pg_backend_pid() AS pid, pg_current_xact_id()::text AS x, iios.org_of_session() AS org");
      const { pid: backendPid, x, org: orgUuid } = s.rows[0] as { pid: number; x: string; org: string };
      const req = crypto.randomUUID();
      const exp = Math.floor(Date.now() / 1000) + 30;
      const msg = ["v1", orgUuid, type, pid, this.purpose, "-", req, backendPid, x, exp].join("|");
      const mac = crypto.createHmac("sha256", org.key).update(msg, "utf8").digest();
      await c.query("SELECT authz.bind_principal($1,$2,$3,$4,$5,$6,$7,$8)", [
        type, pid, this.purpose, null, req, exp, org.keyId, mac,
      ]);
      await c.query("ROLLBACK"); // identity check only — never keep the binding
      return true;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      if ((e as Error).message === "AZ_BIND_PRINCIPAL") return false;
      throw e;
    } finally {
      c.release();
    }
  }

  async close(): Promise<void> {
    for (const p of this.pools.values()) await p.end().catch(() => {});
    this.pools.clear();
  }
}
