// Foundation on a real PostgreSQL (ADR-040 §4): migrations, DAK + row-level security, append-only
// audit, idempotency — each checked as the application role, never as the owner.
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "./db.js";
import { idempotent } from "./idempotency.js";
import { migrate, MIGRATIONS_DIR } from "./migrate.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const ORG_A = "00000000-0000-4000-8000-000000000001";
const ORG_B = "00000000-0000-4000-8000-000000000002";
const scope = (orgId: string) => ({ orgId, principalId: "p-test", requestId: "r-test" });
const row = (orgId: string, action: string) => ({
  org_id: orgId,
  principal_id: "p-test",
  request_id: "r-test",
  iios_request_id: null,
  action,
  resource: JSON.stringify({}),
  outcome: "allowed" as const,
  reason: null,
  before_hash: null,
  after_hash: null,
});

describe.skipIf(!hasPg)("foundation — PostgreSQL", () => {
  let t: TestDb;
  beforeAll(async () => {
    t = await freshDb();
  });
  afterAll(async () => {
    await t?.drop();
  });

  describe("migrations", () => {
    it("a second run applies nothing", async () => {
      expect(await migrate(t.ownerUrl, MIGRATIONS_DIR)).toEqual({
        applied: [],
        already: [
          "0001_foundation.sql",
          "0002_schedule_attendance.sql",
          "0003_makeup.sql",
          "0004_workforce.sql",
          "0005_admissions.sql",
          "0006_billing.sql",
          "0007_partners.sql",
          "0008_partner_settlements.sql",
          "0009_course_studio.sql",
          "0010_class_courses.sql",
        ],
      });
    });
    it("a migration edited after it was applied stops the run", async () => {
      const dir = await mkdtemp(join(tmpdir(), "ogc-mig-"));
      await cp(MIGRATIONS_DIR, dir, { recursive: true });
      const f = join(dir, "0001_foundation.sql");
      await writeFile(f, `${await readFile(f, "utf8")}\n-- edited\n`);
      await expect(migrate(t.ownerUrl, dir)).rejects.toThrow(/changed after it was applied/);
    });
  });

  describe("DAK + row-level security (as ogc_app)", () => {
    it("the application role is not the owner and cannot bypass RLS", async () => {
      const r = await sql<{ bypass: boolean; owner: string }>`
        select (select rolbypassrls from pg_roles where rolname = current_user) as bypass,
               (select tableowner from pg_tables where tablename = 'audit_event') as owner`.execute(
        t.app,
      );
      expect(r.rows[0]).toEqual({ bypass: false, owner: "ogc_owner" });
    });

    it("each organization sees only its own rows; no scope sees nothing", async () => {
      await withTenant(t.app, scope(ORG_A), (tx) =>
        tx.insertInto("audit_event").values(row(ORG_A, "a.one")).execute(),
      );
      await withTenant(t.app, scope(ORG_B), (tx) =>
        tx.insertInto("audit_event").values(row(ORG_B, "b.one")).execute(),
      );
      const seenA = await withTenant(t.app, scope(ORG_A), (tx) =>
        tx.selectFrom("audit_event").select(["org_id", "action"]).execute(),
      );
      expect(seenA.map((r) => r.action)).toEqual(["a.one"]);
      // A query that "forgets" its filter, outside the DAK: nothing.
      const unscoped = await t.app.selectFrom("audit_event").selectAll().execute();
      expect(unscoped).toEqual([]);
    });

    it("a write for another organization is refused by the database", async () => {
      await expect(
        withTenant(t.app, scope(ORG_A), (tx) =>
          tx.insertInto("audit_event").values(row(ORG_B, "smuggle")).execute(),
        ),
      ).rejects.toThrow(/row-level security/);
      // The scope ends with the transaction: the next query on the pool is unscoped again.
      expect(await t.app.selectFrom("audit_event").selectAll().execute()).toEqual([]);
    });

    it("the DAK refuses an organization id that is not a uuid", async () => {
      await expect(withTenant(t.app, scope("org-a' or 1=1 --"), async () => 1)).rejects.toThrow(
        /not a uuid/,
      );
    });
  });

  describe("audit is append-only", () => {
    it("update, delete and truncate are refused", async () => {
      const upd = withTenant(t.app, scope(ORG_A), (tx) =>
        tx.updateTable("audit_event").set({ reason: "x" }).where("action", "=", "a.one").execute(),
      );
      await expect(upd).rejects.toThrow(/permission denied|append-only/);
      const del = withTenant(t.app, scope(ORG_A), (tx) => tx.deleteFrom("audit_event").execute());
      await expect(del).rejects.toThrow(/permission denied|append-only/);
      // Even the owner cannot rewrite it: the trigger refuses.
      const owner = (await import("pg")).default;
      const c = new owner.Client({ connectionString: t.ownerUrl });
      await c.connect();
      try {
        await expect(c.query("delete from audit_event")).rejects.toThrow(/append-only/);
        await expect(c.query("truncate audit_event")).rejects.toThrow(/append-only/);
      } finally {
        await c.end();
      }
    });
  });

  describe("idempotency", () => {
    const input = (orgId: string, body: unknown) => ({
      orgId,
      principalId: "p-test",
      key: "key-0001-abcdef",
      route: "POST /v1/test",
      body,
    });

    it("first run works; the same key + body replays; another body is a conflict", async () => {
      let runs = 0;
      const work = async () => ({ status: 201, body: { n: ++runs } });
      const a1 = await withTenant(t.app, scope(ORG_A), (tx) =>
        idempotent(tx, input(ORG_A, { x: 1 }), work),
      );
      expect(a1).toEqual({ kind: "fresh", status: 201, body: { n: 1 } });
      const a2 = await withTenant(t.app, scope(ORG_A), (tx) =>
        idempotent(tx, input(ORG_A, { x: 1 }), work),
      );
      expect(a2).toEqual({ kind: "replay", status: 201, body: { n: 1 } });
      const a3 = await withTenant(t.app, scope(ORG_A), (tx) =>
        idempotent(tx, input(ORG_A, { x: 2 }), work),
      );
      expect(a3).toEqual({ kind: "conflict" });
      expect(runs).toBe(1);
    });

    it("keys are per organization", async () => {
      const b = await withTenant(t.app, scope(ORG_B), (tx) =>
        idempotent(tx, input(ORG_B, { x: 1 }), async () => ({ status: 201, body: { b: true } })),
      );
      expect(b.kind).toBe("fresh");
    });

    it("a failed write leaves no key behind (same transaction)", async () => {
      const k = { ...input(ORG_A, { y: 1 }), key: "key-0002-abcdef" };
      await expect(
        withTenant(t.app, scope(ORG_A), (tx) =>
          idempotent(tx, k, async () => {
            throw new Error("boom");
          }),
        ),
      ).rejects.toThrow("boom");
      const again = await withTenant(t.app, scope(ORG_A), (tx) =>
        idempotent(tx, k, async () => ({ status: 201, body: { ok: 1 } })),
      );
      expect(again.kind).toBe("fresh");
    });
  });
});
