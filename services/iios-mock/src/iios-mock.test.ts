// MOCK IIOS (ADR-040 §3.3): issues, resolves (5 states), carries orgAdmin + narrowing, revokes.
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { buildIiosMock, type IiosMockState } from "./server.js";
import { CENTER_D1, ORG_LUMEN, ORG_NOVA } from "./seed.js";

const SECRET = "test-client-secret-0123456789";
let t = Date.parse("2026-11-23T08:00:00Z");
let app: ReturnType<typeof buildIiosMock>["app"];
let state: IiosMockState;

beforeEach(() => {
  t = Date.parse("2026-11-23T08:00:00Z");
  ({ app, state } = buildIiosMock({
    key: randomBytes(32),
    clientId: "ogc",
    clientSecret: SECRET,
    now: () => t,
  }));
});

const auth = { authorization: `Bearer ${SECRET}` };
const issue = async (principalId: string, orgId = ORG_NOVA, extra: object = {}) => {
  const r = await app.inject({
    method: "POST",
    url: "/v1/dev/grants",
    headers: auth,
    payload: { principalId, orgId, ...extra },
  });
  return { status: r.statusCode, body: r.json() as { grant: string } };
};
const resolve = async (grant: string, intendedOrgId = ORG_NOVA) =>
  (
    await app.inject({
      method: "POST",
      url: "/v1/grants/resolve",
      headers: auth,
      payload: { grant, intendedOrgId },
    })
  ).json();

describe("mock IIOS — client credential", () => {
  it("refuses a caller without the client secret", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/grants/resolve", payload: {} });
    expect(r.statusCode).toBe(401);
    const w = await app.inject({
      method: "POST",
      url: "/v1/grants/resolve",
      headers: { authorization: "Bearer wrong-secret-0123456789abcd" },
      payload: {},
    });
    expect(w.statusCode).toBe(401);
  });
  it("refuses a key shorter than 32 bytes", () => {
    expect(() =>
      buildIiosMock({ key: randomBytes(16), clientId: "ogc", clientSecret: SECRET }),
    ).toThrow(/32 bytes/);
  });
});

describe("mock IIOS — resolve decides five states", () => {
  it("valid: role, orgAdmin and narrowing come from IIOS's own directory", async () => {
    const { body } = await issue("iios-principal-admin-1");
    const r = await resolve(body.grant);
    expect(r.state).toBe("valid");
    expect(r.context).toMatchObject({
      orgId: ORG_NOVA,
      principalId: "iios-principal-admin-1",
      role: "staff",
      orgAdmin: true,
      narrowing: { state: "none" },
    });
  });

  it("missing: tampered, garbage or empty token", async () => {
    const { body } = await issue("iios-principal-staff-1");
    const [p, mac] = body.grant.split(".");
    const forged = Buffer.from(
      Buffer.from(p, "base64url").toString().replace("staff-1", "admin-1"),
    ).toString("base64url");
    expect((await resolve(`${forged}.${mac}`)).state).toBe("missing");
    expect((await resolve("not-a-grant")).state).toBe("missing");
    expect((await resolve("")).state).toBe("missing");
  });

  it("expired, revoked, cross_tenant", async () => {
    const { body } = await issue("iios-principal-staff-1", ORG_NOVA, { ttlSeconds: 60 });
    expect((await resolve(body.grant, ORG_LUMEN)).state).toBe("cross_tenant");
    t += 61_000;
    expect((await resolve(body.grant)).state).toBe("expired");
    const fresh = (await issue("iios-principal-staff-1")).body.grant;
    await app.inject({
      method: "POST",
      url: "/v1/dev/grants/revoke",
      headers: auth,
      payload: { grant: fresh },
    });
    expect((await resolve(fresh)).state).toBe("revoked");
  });

  it("only members with a role get a grant; centers must belong to the org", async () => {
    expect((await issue("iios-principal-norole-1")).status).toBe(404);
    expect((await issue("iios-principal-staff-1", ORG_LUMEN)).status).toBe(404);
    expect((await issue("iios-principal-staff-1", ORG_NOVA, { activeCenter: "nope" })).status).toBe(
      422,
    );
    const ok = await issue("iios-principal-staff-1", ORG_NOVA, { activeCenter: CENTER_D1 });
    expect((await resolve(ok.body.grant)).context.activeCenter).toBe(CENTER_D1);
  });
});

describe("mock IIOS — narrowing", () => {
  it("an attached active policy narrows; a retired one makes the grant unavailable", async () => {
    state.attachments.set("iios-principal-staff-1", "policy-front-desk-d1");
    const g = (await issue("iios-principal-staff-1")).body.grant;
    expect((await resolve(g)).context.narrowing).toMatchObject({
      state: "policy",
      policyRef: "policy-front-desk-d1",
      version: 1,
    });
    state.policies.get("policy-front-desk-d1")!.status = "retired";
    expect((await resolve(g)).context.narrowing).toEqual({ state: "unavailable" });
    state.attachments.set("iios-principal-staff-1", "policy-gone");
    expect((await resolve(g)).context.narrowing).toEqual({ state: "unavailable" });
  });

  it("an Org Admin is never narrowed", async () => {
    state.attachments.set("iios-principal-admin-1", "policy-front-desk-d1");
    const g = (await issue("iios-principal-admin-1")).body.grant;
    expect((await resolve(g)).context.narrowing).toEqual({ state: "none" });
  });
});
