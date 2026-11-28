// resolve sources role + orgAdmin from the kernel when one is configured (S3c, OGC-ADR-043).
// Uses a stub KernelResolver — no database — to prove the wiring; client.test.ts covers the
// real KernelDirectory against the kernel.
import { describe, it, beforeEach, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { buildIiosMock } from "./server.js";
import { sign } from "./token.js";
import type { KernelResolver, ResolvedMember } from "./kernel/client.js";

const SECRET = "client-secret-0123456789abcdef";
const KEY = randomBytes(32);
const ORG = "00000000-0000-4000-8000-000000000001";
const nowS = () => Math.floor(Date.now() / 1000);

// Stub: deliberately returns roles that DIFFER from the seed directory, so a pass proves the
// value came from the kernel, not the seed.
const stub: KernelResolver = {
  async resolve(orgId, sub): Promise<ResolvedMember | null> {
    if (orgId !== ORG) return null;
    if (sub === "kernel-admin") return { role: "staff", orgAdmin: true };
    if (sub === "kernel-teacher") return { role: "teacher", orgAdmin: false };
    if (sub === "kernel-learner") return { role: "learner", orgAdmin: false };
    return null;
  },
};

describe("resolve via the kernel (S3c)", () => {
  let app: ReturnType<typeof buildIiosMock>["app"];
  beforeEach(() => {
    ({ app } = buildIiosMock({ key: KEY, clientId: "ogc", clientSecret: SECRET, kernel: stub }));
  });

  const grant = (sub: string) =>
    sign(KEY, { cid: "ogc", org: ORG, sub, purpose: "ogc.platform", iat: nowS(), exp: nowS() + 3600 }).token;

  const resolve = (sub: string) =>
    app.inject({
      method: "POST",
      url: "/v1/grants/resolve",
      headers: { authorization: `Bearer ${SECRET}`, "content-type": "application/json" },
      payload: { grant: grant(sub), intendedOrgId: ORG },
    });

  it("admin: role=staff, orgAdmin=true from the kernel", async () => {
    const body = (await resolve("kernel-admin")).json();
    expect(body.state).toBe("valid");
    expect(body.context.role).toBe("staff");
    expect(body.context.orgAdmin).toBe(true);
  });

  it("teacher: role=teacher, orgAdmin=false", async () => {
    const body = (await resolve("kernel-teacher")).json();
    expect(body.context.role).toBe("teacher");
    expect(body.context.orgAdmin).toBe(false);
  });

  it("learner: role=learner", async () => {
    const body = (await resolve("kernel-learner")).json();
    expect(body.context.role).toBe("learner");
    expect(body.context.orgAdmin).toBe(false);
  });

  it("a principal the kernel does not hold → revoked (kernel is the authority)", async () => {
    const body = (await resolve("not-in-kernel")).json();
    expect(body.state).toBe("revoked");
  });
});
