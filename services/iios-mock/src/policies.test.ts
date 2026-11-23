// Access policy administration in the mock IIOS (OGC-ADR-039 option C): the demo's rules, server-side,
// over HTTP with the caller's grant; memory store here, PostgreSQL store below (needs a database).
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PolicyResult } from "@ogc/contracts";
import { buildIiosMock } from "./server.js";
import { migrate, pgStore, seedIfMissing } from "./pgStore.js";
import { CENTER_D1, CENTER_HAI_CHAU, ORG_LUMEN, ORG_NOVA, seedPolicies } from "./seed.js";
import type { PolicyStore } from "./policies.js";

const SECRET = "policies-test-secret-0123456789";
const OLIVIA = "iios-principal-admin-1";
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const LINH = "iios-principal-learner-1";

function harness(store?: PolicyStore) {
  const mock = buildIiosMock({
    key: randomBytes(32),
    clientId: "ogc",
    clientSecret: SECRET,
    ...(store ? { store } : {}),
  });
  const call = async (url: string, payload: unknown) => {
    const r = await mock.app.inject({
      method: "POST",
      url,
      headers: { authorization: `Bearer ${SECRET}` },
      payload: payload as object,
    });
    return { status: r.statusCode, body: r.json() };
  };
  const grant = async (principalId: string, orgId = ORG_NOVA) =>
    (await call("/v1/dev/grants", { principalId, orgId })).body.grant as string;
  const as = async (principalId: string, orgId = ORG_NOVA) => {
    const g = await grant(principalId, orgId);
    return {
      grant: g,
      view: () => call("/v1/admin/policies/view", { grant: g, orgId }),
      create: (input: unknown) => call("/v1/admin/policies/create", { grant: g, orgId, input }),
      revise: (ref: string, expectedVersion: number, patch: unknown) =>
        call("/v1/admin/policies/revise", { grant: g, orgId, ref, expectedVersion, patch }),
      retire: (ref: string, expectedVersion: number) =>
        call("/v1/admin/policies/retire", { grant: g, orgId, ref, expectedVersion }),
      attach: (principalId: string, policyRef: string | null) =>
        call("/v1/admin/attach", { grant: g, orgId, principalId, policyRef }),
      narrowing: async () =>
        (await call("/v1/grants/resolve", { grant: g, intendedOrgId: orgId })).body.context
          .narrowing,
    };
  };
  return { ...mock, call, grant, as };
}
const res = (r: { body: unknown }) => r.body as PolicyResult;
const reason = (r: { body: unknown }) => (res(r) as { reason?: string }).reason;

describe("policy admin (memory store)", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("only an Org Admin (from IIOS member data) sees or changes policies", async () => {
    const sam = await h.as(SAM);
    expect((await sam.view()).status).toBe(403);
    expect(reason(await sam.create({ name: "Mine", rules: [{ action: "students:view" }] }))).toBe(
      "not_admin",
    );
    expect(reason(await sam.attach(TARA, "policy-own-classes"))).toBe("not_admin");
    const v = (await (await h.as(OLIVIA)).view()).body;
    expect(v.stats).toEqual({
      members: 8,
      staffAndTeachers: 4,
      privileged: 1,
      restricted: 0,
      noRole: 1,
    });
    expect(v.policies.map((p: { name: string }) => p.name)).toEqual([
      "Front desk — District 1 only",
      "Teacher — own classes only",
    ]);
    expect(v.memberships.find((m: { isYou: boolean }) => m.isYou).principalId).toBe(OLIVIA);
  });

  it("the grant decides who and where: bad, revoked or other-org grants are refused", async () => {
    expect(
      (await h.call("/v1/admin/policies/view", { grant: "x.y", orgId: ORG_NOVA })).status,
    ).toBe(401);
    const o = await h.as(OLIVIA);
    expect(
      (await h.call("/v1/admin/policies/view", { grant: o.grant, orgId: ORG_LUMEN })).status,
    ).toBe(401);
    await h.call("/v1/dev/grants/revoke", { grant: o.grant });
    expect((await o.view()).status).toBe(401);
    // Lumen's staff member is not an admin anywhere
    expect((await (await h.as("iios-principal-staff-org2", ORG_LUMEN)).view()).status).toBe(403);
  });

  it("closed catalog: unknown action / condition / center / read-only field refused with a path", async () => {
    const o = await h.as(OLIVIA);
    const bad = async (rules: unknown, path: string) => {
      const r = res(await o.create({ name: "Bad one", rules }));
      expect(r).toMatchObject({ ok: false, reason: "invalid", path });
    };
    await bad([{ action: "users:delete" }], "rules[0].action");
    await bad(
      [{ action: "students:view", criteria: { sessionRole: ["owner"] } }],
      "rules[0].criteria.sessionRole",
    );
    await bad(
      [{ action: "schedule:manage", criteria: { centerId: [CENTER_HAI_CHAU] } }],
      "rules[0].criteria.centerId[0]",
    );
    await bad(
      [{ action: "students:view", readonlyFields: ["classTeacher"] }],
      "rules[0].readonlyFields[0]",
    );
    await bad([], "rules");
    expect(res(await o.create({ name: "ab", rules: [{ action: "students:view" }] }))).toMatchObject(
      {
        reason: "invalid",
        path: "name",
      },
    );
    expect(
      reason(
        await o.create({
          name: "teacher — OWN classes only",
          rules: [{ action: "students:view" }],
        }),
      ),
    ).toBe("name_taken");
  });

  it("create → revise (versioned, stale refused) → history newest first, by name", async () => {
    const o = await h.as(OLIVIA);
    const c = res(
      await o.create({
        name: "Thu Duc desk",
        description: " ",
        rules: [{ action: "schedule:manage", criteria: { centerId: [CENTER_D1, CENTER_D1] } }],
      }),
    );
    if (!c.ok) throw new Error(c.reason);
    const p = c.view.policies.find((x) => x.name === "Thu Duc desk")!;
    expect(p).toMatchObject({ version: 1, status: "active", description: null });
    expect(p.rules).toEqual([{ action: "schedule:manage", criteria: { centerId: [CENTER_D1] } }]);
    expect(reason(await o.revise(p.id, 2, { description: "x" }))).toBe("stale");
    const r = res(
      await o.revise(p.id, 1, {
        description: "Front desk at D1",
        rules: [{ action: "students:view" }],
      }),
    );
    if (!r.ok) throw new Error(r.reason);
    const q = r.view.policies.find((x) => x.id === p.id)!;
    expect(q).toMatchObject({
      version: 2,
      description: "Front desk at D1",
      rules: [{ action: "students:view" }],
    });
    expect(q.history.map((x) => [x.version, x.change, x.changedBy])).toEqual([
      [2, "revised", "Olivia (Org Admin)"],
      [1, "created", "Olivia (Org Admin)"],
    ]);
  });

  it("attach narrows the next resolve; detach restores; learners take no policy; no self-change", async () => {
    const o = await h.as(OLIVIA);
    const sam = await h.as(SAM);
    expect(await sam.narrowing()).toEqual({ state: "none" });
    const a = res(await o.attach(SAM, "policy-front-desk-d1"));
    expect(a.ok && a.view.stats.restricted).toBe(1);
    expect(await sam.narrowing()).toMatchObject({
      state: "policy",
      policyRef: "policy-front-desk-d1",
      version: 1,
    });
    expect(reason(await o.attach(LINH, "policy-own-classes"))).toBe("not_applicable");
    expect(reason(await o.attach(OLIVIA, "policy-own-classes"))).toBe("self");
    expect(reason(await o.attach("iios-principal-staff-org2", "policy-own-classes"))).toBe(
      "not_found",
    );
    expect(reason(await o.attach(TARA, "policy-nope"))).toBe("not_found");
    await o.attach(SAM, null);
    expect(await sam.narrowing()).toEqual({ state: "none" });
  });

  it("retire: not while in use; final once retired; cannot be attached; a policy restricting you is off-limits", async () => {
    const o = await h.as(OLIVIA);
    await o.attach(TARA, "policy-own-classes");
    expect(reason(await o.retire("policy-own-classes", 1))).toBe("in_use");
    await o.attach(TARA, null);
    const r = res(await o.retire("policy-own-classes", 1));
    expect(r.ok && r.view.policies.at(-1)).toMatchObject({
      id: "policy-own-classes",
      status: "retired",
      version: 2,
    });
    expect(reason(await o.retire("policy-own-classes", 2))).toBe("retired");
    expect(reason(await o.revise("policy-own-classes", 2, { description: "x" }))).toBe("retired");
    expect(reason(await o.attach(TARA, "policy-own-classes"))).toBe("retired");
    // tampered state: a policy that (somehow) restricts the admin cannot be edited or retired by them
    h.state.attachments.set(OLIVIA, "policy-front-desk-d1");
    expect(reason(await o.revise("policy-front-desk-d1", 1, { description: "x" }))).toBe("self");
    expect(reason(await o.retire("policy-front-desk-d1", 1))).toBe("self");
  });

  it("a retired policy still attached fails closed at resolve", async () => {
    const o = await h.as(OLIVIA);
    await o.attach(SAM, "policy-front-desk-d1");
    h.state.policies.get("policy-front-desk-d1")!.status = "retired"; // tamper
    expect(await (await h.as(SAM)).narrowing()).toEqual({ state: "unavailable" });
  });
});

// ── PostgreSQL store ───────────────────────────────────────────────────────────────────────────
const ADMIN_URL = process.env.OGC_TEST_PG_ADMIN_URL ?? "";
if (!ADMIN_URL && process.env.CI) throw new Error("OGC_TEST_PG_ADMIN_URL is required in CI");

describe.skipIf(!ADMIN_URL)("policy store on PostgreSQL", () => {
  const name = `iios_test_${randomBytes(5).toString("hex")}`;
  let pool: pg.Pool;
  beforeAll(async () => {
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`create database ${name}`);
    await a.end();
    const u = new URL(ADMIN_URL);
    u.pathname = `/${name}`;
    pool = new pg.Pool({ connectionString: u.toString(), max: 6 });
  });
  afterAll(async () => {
    await pool?.end();
    const a = new pg.Client({ connectionString: ADMIN_URL });
    await a.connect();
    await a.query(`drop database if exists ${name} with (force)`);
    await a.end();
  });

  it("migrates once, seeds once, survives a restart, keeps history append-only, serialises writes", async () => {
    expect(await migrate(pool)).toEqual(["0001_policies.sql"]);
    expect(await migrate(pool)).toEqual([]);
    expect(await seedIfMissing(pool, seedPolicies())).toBe(2);
    expect(await seedIfMissing(pool, seedPolicies())).toBe(0);

    const h1 = harness(pgStore(pool));
    const o = await h1.as(OLIVIA);
    await o.attach(SAM, "policy-front-desk-d1");
    const c = res(await o.create({ name: "Evening desk", rules: [{ action: "students:view" }] }));
    if (!c.ok) throw new Error(c.reason);
    const ref = c.view.policies.find((p) => p.name === "Evening desk")!.id;
    await o.revise(ref, 1, { description: "v2" });

    // "restart": a new mock (new key, new in-memory state) on the same database
    const h2 = harness(pgStore(pool));
    const v = (await (await h2.as(OLIVIA)).view()).body;
    expect(v.stats.restricted).toBe(1);
    expect(v.policies.find((p: { id: string }) => p.id === ref)).toMatchObject({
      version: 2,
      description: "v2",
    });
    expect(
      v.policies
        .find((p: { id: string }) => p.id === ref)
        .history.map((x: { change: string }) => x.change),
    ).toEqual(["revised", "created"]);
    expect(await (await h2.as(SAM)).narrowing()).toMatchObject({
      state: "policy",
      policyRef: "policy-front-desk-d1",
    });
    // editing the seed again does not overwrite it
    expect(await seedIfMissing(pool, seedPolicies())).toBe(0);

    await expect(pool.query("update iios_policy_history set changed_by = 'x'")).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query("delete from iios_policy_history")).rejects.toThrow(/append-only/);

    // two admins racing to create the same name: exactly one wins
    const o2 = await h2.as(OLIVIA);
    const both = await Promise.all([
      o.create({ name: "Race", rules: [{ action: "students:view" }] }),
      o2.create({ name: "Race", rules: [{ action: "students:view" }] }),
    ]);
    expect(both.map((r) => (res(r).ok ? "ok" : reason(r))).sort()).toEqual(["name_taken", "ok"]);
  });
});
