// API pipeline against the mock IIOS over HTTP and a real PostgreSQL (ADR-040 §4): every refusal
// is fail-closed, authorize() decides with IIOS's narrowing, denials and writes are audited in the
// caller's organization, writes are idempotent.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient, type IiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const NOVA = "00000000-0000-4000-8000-000000000001";
const LUMEN = "00000000-0000-4000-8000-000000000002";
const D1 = "00000000-0000-4000-8000-000000000c01";
const THU_DUC = "00000000-0000-4000-8000-000000000c02";
const SECRET = "api-test-client-secret-0123456789";

describe.skipIf(!hasPg)("api — pipeline", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let iiosState: IiosMockState;
  let iiosUrl: string;
  let api: ReturnType<typeof buildApi>;

  const build = (client: IiosClient) => {
    const a = buildApi({ db: t.app, iios: client });
    // Test-only routes exercising authorize → write → audit through the real pipeline.
    a.secured("POST", "/v1/test/sessions", async (caller, req) => {
      const b = req.body as { centerId: string; title: string };
      const ro = await caller.authorize("schedule:manage", { centerId: b.centerId });
      if (!ro) return;
      await caller.write("POST /v1/test/sessions", b, async () => ({
        status: 201,
        body: { created: b.title, readonly: ro },
        audit: {
          action: "schedule:manage",
          resource: { centerId: b.centerId },
          outcome: "allowed",
          after: b,
        },
      }));
    });
    a.secured("GET", "/v1/test/audit", async (caller) =>
      caller.tenant((tx) =>
        tx
          .selectFrom("audit_event")
          .select(["org_id", "action", "outcome", "reason", "principal_id"])
          .orderBy("at")
          .execute(),
      ),
    );
    return a;
  };

  let fake: import("fastify").FastifyInstance;
  let fakeBase = "";
  const fakeUrl = (mode: string) => `${fakeBase}/${mode}`;

  beforeAll(async () => {
    t = await freshDb();
    fake = (await import("fastify")).default();
    const ctx = {
      clientId: "ogc",
      orgId: LUMEN,
      principalId: "iios-principal-staff-org2",
      role: "staff",
      purpose: "ogc.platform",
      requestId: "r",
      grantRef: "g",
      expiresAt: "2099-01-01T00:00:00Z",
    };
    fake.post("/lumen/v1/grants/resolve", async () => ({ state: "valid", context: ctx }));
    fake.post("/nocontext/v1/grants/resolve", async () => ({ state: "valid" }));
    fake.post("/garbage/v1/grants/resolve", async () => ({ state: "maybe" }));
    await fake.listen({ host: "127.0.0.1", port: 0 });
    fakeBase = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
    ({ app: iios, state: iiosState } = buildIiosMock({
      key: randomBytes(32),
      clientId: "ogc",
      clientSecret: SECRET,
    }));
    await iios.listen({ host: "127.0.0.1", port: 0 });
    iiosUrl = `http://127.0.0.1:${(iios.server.address() as AddressInfo).port}`;
    api = build(httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }));
    await api.ready();
  });
  afterAll(async () => {
    await api?.close();
    await iios?.close();
    await fake?.close();
    await t?.drop();
  });

  const grantFor = async (principalId: string, orgId = NOVA) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId }),
    });
    return ((await r.json()) as { grant: string }).grant;
  };
  const call = (
    method: "GET" | "POST",
    url: string,
    grant: string | null,
    opts: { org?: string; body?: unknown; key?: string } = {},
  ) =>
    api.inject({
      method,
      url,
      headers: {
        ...(grant ? { authorization: `Bearer ${grant}` } : {}),
        "x-ogc-org": opts.org ?? NOVA,
        ...(opts.key ? { "idempotency-key": opts.key } : {}),
      },
      ...(opts.body ? { payload: opts.body as object } : {}),
    });

  describe("fail-closed admission", () => {
    it("health is public; everything else needs a decided grant", async () => {
      expect((await api.inject({ method: "GET", url: "/v1/health" })).json()).toEqual({ ok: true });
      const r = await call("GET", "/v1/me/access", null);
      expect(r.statusCode).toBe(401);
      expect(r.json()).toEqual({ error: "iios_denied", state: "missing" });
      expect(r.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("forged grant → missing; another organization → cross_tenant; bad org header → 400", async () => {
      expect((await call("GET", "/v1/me/access", "forged.token")).json().state).toBe("missing");
      const g = await grantFor("iios-principal-staff-1");
      expect((await call("GET", "/v1/me/access", g, { org: LUMEN })).json().state).toBe(
        "cross_tenant",
      );
      expect((await call("GET", "/v1/me/access", g, { org: "nova" })).statusCode).toBe(400);
    });

    it("IIOS down, erroring or answering off-contract → 503, never through", async () => {
      const g = await grantFor("iios-principal-staff-1");
      const variants: IiosClient[] = [
        httpIiosClient({ baseUrl: "http://127.0.0.1:9", clientSecret: SECRET, timeoutMs: 300 }),
        httpIiosClient({ baseUrl: iiosUrl, clientSecret: "wrong-secret-xxxxxxxxxxxxxxxx" }),
        // Off-contract answers from a fake IIOS: "valid" for another organization, "valid" with
        // no context, and a body that is not the contract.
        httpIiosClient({ baseUrl: fakeUrl("lumen"), clientSecret: SECRET }),
        httpIiosClient({ baseUrl: fakeUrl("nocontext"), clientSecret: SECRET }),
        httpIiosClient({ baseUrl: fakeUrl("garbage"), clientSecret: SECRET }),
      ];
      for (const v of variants) {
        const a = build(v);
        const r = await a.inject({
          method: "GET",
          url: "/v1/me/access",
          headers: { authorization: `Bearer ${g}`, "x-ogc-org": NOVA },
        });
        expect(r.statusCode).toBe(503);
        await a.close();
      }
    });
  });

  describe("authorization with IIOS narrowing", () => {
    it("/v1/me/access reflects role, Org Admin and the attached policy", async () => {
      const admin = (
        await call("GET", "/v1/me/access", await grantFor("iios-principal-admin-1"))
      ).json();
      expect(admin).toMatchObject({ role: "staff", orgAdmin: true, narrowing: { state: "none" } });
      expect(admin.allowed).toContain("center:setup");
      iiosState.attachments.set("iios-principal-staff-1", "policy-front-desk-d1");
      const sam = (
        await call("GET", "/v1/me/access", await grantFor("iios-principal-staff-1"))
      ).json();
      expect(sam.narrowing).toMatchObject({
        state: "policy",
        name: "Front desk — District 1 only",
      });
      expect(sam.allowed).toContain("schedule:manage");
      expect(sam.allowed).not.toContain("center:setup");
      const tara = (
        await call("GET", "/v1/me/access", await grantFor("iios-principal-teacher-1"))
      ).json();
      expect(tara.allowed).not.toContain("schedule:manage");
    });

    it("a denied write is refused (403) and audited as denied in the caller's organization", async () => {
      iiosState.attachments.set("iios-principal-staff-1", "policy-front-desk-d1");
      const g = await grantFor("iios-principal-staff-1");
      const r = await call("POST", "/v1/test/sessions", g, {
        body: { centerId: THU_DUC, title: "Extra session" },
        key: "write-key-0001",
      });
      expect(r.statusCode).toBe(403);
      expect(r.json()).toEqual({ error: "forbidden", reason: "narrowing" });
      const log = (await call("GET", "/v1/test/audit", g)).json();
      expect(log.at(-1)).toMatchObject({
        org_id: NOVA,
        principal_id: "iios-principal-staff-1",
        action: "schedule:manage",
        outcome: "denied",
        reason: "narrowing",
      });
    });

    it("an allowed write: read-only fields from the policy, audited, idempotent", async () => {
      iiosState.attachments.set("iios-principal-staff-1", "policy-front-desk-d1");
      const g = await grantFor("iios-principal-staff-1");
      const body = { centerId: D1, title: "Extra session" };
      expect((await call("POST", "/v1/test/sessions", g, { body })).statusCode).toBe(400); // no key
      const first = await call("POST", "/v1/test/sessions", g, { body, key: "write-key-0002" });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toEqual({
        created: "Extra session",
        readonly: ["classTeacher", "substitute"],
      });
      const replay = await call("POST", "/v1/test/sessions", g, { body, key: "write-key-0002" });
      expect(replay.statusCode).toBe(201);
      expect(replay.headers["idempotent-replay"]).toBe("true");
      const reused = await call("POST", "/v1/test/sessions", g, {
        body: { ...body, title: "Other" },
        key: "write-key-0002",
      });
      expect(reused.statusCode).toBe(409);
      const allowed = (await call("GET", "/v1/test/audit", g))
        .json()
        .filter((e: { outcome: string }) => e.outcome === "allowed");
      expect(allowed).toHaveLength(1); // the replay did not write twice
    });

    it("another organization's staff sees none of it", async () => {
      const lumen = await grantFor("iios-principal-staff-org2", LUMEN);
      expect((await call("GET", "/v1/test/audit", lumen, { org: LUMEN })).json()).toEqual([]);
    });
  });
});
