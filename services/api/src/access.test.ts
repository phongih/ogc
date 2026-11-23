// Access policies through the Platform API (OGC-ADR-039 option C): the API relays the caller's own
// grant to the mock IIOS over HTTP, maps the decision to a status, and adds idempotency + audit.
// A policy attached here narrows the next request on the Schedule routes.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { withTenant } from "./db.js";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { A2E, A2M, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "access-test-secret-0123456789";
const OLIVIA = "iios-principal-admin-1";
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
const NOW = Date.parse("2026-11-23T05:00:00Z");
let seq = 0;
const key = () => `acc-${Date.now()}-${++seq}-xyz`;

describe.skipIf(!hasPg)("access policies — API → IIOS", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;

  beforeAll(async () => {
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
  });
  beforeEach(async () => {
    await iios?.close();
    await api?.close();
    ({ app: iios, state } = buildIiosMock({
      key: randomBytes(32),
      clientId: "ogc",
      clientSecret: SECRET,
    }));
    await iios.listen({ host: "127.0.0.1", port: 0 });
    iiosUrl = `http://127.0.0.1:${(iios.server.address() as AddressInfo).port}`;
    api = buildApi({
      db: t.app,
      iios: httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
      now: () => NOW,
    });
    await api.ready();
  });
  afterAll(async () => {
    await api?.close();
    await iios?.close();
    await t?.drop();
  });

  const as = async (principalId: string) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId: NOVA }),
    });
    const g = ((await r.json()) as { grant: string }).grant;
    return (
      method: "GET" | "POST" | "PUT",
      url: string,
      body?: unknown,
      k: string | null = key(),
    ) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": NOVA,
          ...(method !== "GET" && k ? { "idempotency-key": k } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
  };
  const auditRows = () =>
    withTenant(t.app, { orgId: NOVA, principalId: "test", requestId: "test" }, (tx) =>
      tx
        .selectFrom("audit_event")
        .select(["action", "outcome", "reason", "principal_id"])
        .where("action", "like", "access:%")
        .execute(),
    );

  it("Olivia sees the view; staff and teachers get 403 and the denial is audited", async () => {
    const o = await as(OLIVIA);
    const v = (await o("GET", "/v1/access/admin")).json();
    expect(v.orgName).toBe("Nova Learning");
    expect(v.policies).toHaveLength(2);
    const before = (await auditRows()).length;
    expect((await (await as(SAM))("GET", "/v1/access/admin")).statusCode).toBe(403);
    expect(
      (await (await as(TARA))("PUT", `/v1/access/members/${SAM}/policy`, { policyRef: null }))
        .statusCode,
    ).toBe(403);
    const rows = await auditRows();
    expect(rows.length).toBe(before + 2);
    expect(rows.slice(-2).every((r) => r.outcome === "denied" && r.reason === "not_admin")).toBe(
      true,
    );
  });

  it("attach via the API narrows Sam's next Schedule request to District 1; detach restores", async () => {
    const o = await as(OLIVIA);
    const sam = await as(SAM);
    const all = async () =>
      ((await sam("GET", "/v1/schedule")).json().classes as { classId: string }[])
        .map((c) => c.classId)
        .sort();
    expect(await all()).toHaveLength(3);
    const r = await o("PUT", `/v1/access/members/${SAM}/policy`, {
      policyRef: "policy-front-desk-d1",
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().view.stats.restricted).toBe(1);
    expect(await all()).toEqual([A2M, A2E].sort());
    expect(
      (await o("PUT", `/v1/access/members/${SAM}/policy`, { policyRef: null })).json().ok,
    ).toBe(true);
    expect(await all()).toHaveLength(3);
  });

  it("IIOS refusals map to statuses: invalid 422 (with path), stale / self / in_use 409, not_found 404", async () => {
    const o = await as(OLIVIA);
    const bad = await o("POST", "/v1/access/policies", {
      name: "Bad",
      rules: [{ action: "users:delete" }],
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ ok: false, reason: "invalid", path: "rules[0].action" });
    expect(
      (
        await o("PUT", "/v1/access/policies/policy-front-desk-d1", {
          expectedVersion: 7,
          description: "x",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await o("PUT", `/v1/access/members/${OLIVIA}/policy`, { policyRef: "policy-own-classes" })
      ).json().reason,
    ).toBe("self");
    await o("PUT", `/v1/access/members/${TARA}/policy`, { policyRef: "policy-own-classes" });
    const inUse = await o("POST", "/v1/access/policies/policy-own-classes/retire", {
      expectedVersion: 1,
    });
    expect([inUse.statusCode, inUse.json().reason]).toEqual([409, "in_use"]);
    expect(
      (await o("PUT", "/v1/access/members/nobody/policy", { policyRef: null })).statusCode,
    ).toBe(404);
    expect(
      (await o("PUT", "/v1/access/policies/bad ref!", { expectedVersion: 1 })).statusCode,
    ).toBe(400);
  });

  it("writes are idempotent (IIOS called once) and audited once; a reused key with another body is 409", async () => {
    const o = await as(OLIVIA);
    const k = key();
    const body = { name: "Evening desk", rules: [{ action: "students:view" }] };
    const a = await o("POST", "/v1/access/policies", body, k);
    const b = await o("POST", "/v1/access/policies", body, k);
    expect(a.statusCode).toBe(200);
    expect(b.headers["idempotent-replay"]).toBe("true");
    expect(b.json()).toEqual(a.json());
    expect([...state.policies.values()].filter((p) => p.name === "Evening desk")).toHaveLength(1);
    expect((await o("POST", "/v1/access/policies", { ...body, name: "Other" }, k)).statusCode).toBe(
      409,
    );
    const created = (await auditRows()).filter(
      (r) => r.action === "access:policy.create" && r.outcome === "allowed",
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ outcome: "allowed", principal_id: OLIVIA });
    expect((await o("POST", "/v1/access/policies", body, null)).statusCode).toBe(400);
  });

  it("IIOS down: reads and writes fail closed (503) and nothing is stored under the key", async () => {
    const o = await as(OLIVIA);
    const k = key();
    // grants still resolve, but IIOS's admin answers are unusable
    const down = buildApi({
      db: t.app,
      iios: {
        ...httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
        policyAdmin: async () => ({ kind: "unavailable" as const }),
      },
      now: () => NOW,
    });
    await down.ready();
    const g = (
      (await (
        await fetch(`${iiosUrl}/v1/dev/grants`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
          body: JSON.stringify({ principalId: OLIVIA, orgId: NOVA }),
        })
      ).json()) as { grant: string }
    ).grant;
    const h = { authorization: `Bearer ${g}`, "x-ogc-org": NOVA };
    expect(
      (await down.inject({ method: "GET", url: "/v1/access/admin", headers: h })).statusCode,
    ).toBe(503);
    const w = await down.inject({
      method: "PUT",
      url: `/v1/access/members/${SAM}/policy`,
      headers: { ...h, "idempotency-key": k },
      payload: { policyRef: "policy-front-desk-d1" },
    });
    expect(w.statusCode).toBe(503);
    await down.close();
    // the same key now goes through for real: nothing was stored by the failed attempt
    const ok = await o(
      "PUT",
      `/v1/access/members/${SAM}/policy`,
      { policyRef: "policy-front-desk-d1" },
      k,
    );
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["idempotent-replay"]).toBeUndefined();
  });
});
