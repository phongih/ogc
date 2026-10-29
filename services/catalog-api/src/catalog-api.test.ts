import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { PUBLIC_COURSE_FIELDS } from "@ogc/contracts";
import { createCatalogServer } from "./server.js";
import { PUBLIC_FIELDS } from "./catalog.js";

const NOVA = "nova-learning";
const LUMEN = "lumen-edu";
const E01 = "00000000-0000-4000-8000-000000000e01"; // published (Nova)
const E04 = "00000000-0000-4000-8000-000000000e04"; // UNPUBLISHED (Nova)
const F01 = "00000000-0000-4000-8000-000000000f01"; // published (Lumen)

let server: Server;
let base: string;

beforeAll(async () => {
  server = createCatalogServer({ rateLimit: null }); // throttle off for functional tests
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}/api/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// Test helper: parsed JSON is intentionally loose (`any`) so assertions can reach
// into the response envelope without re-declaring it in every test.
/* eslint-disable @typescript-eslint/no-explicit-any */
const get = async (path: string, headers?: Record<string, string>) => {
  const res = await fetch(`${base}${path}`, { headers });
  const body = (await res.json().catch(() => null)) as any;
  return { status: res.status, body, res };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("public catalog — contract", () => {
  it("lists published, org-scoped courses in the success envelope", async () => {
    const { status, body } = await get(`/public/orgs/${NOVA}/courses`);
    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(3); // 3 published Nova courses (e04 unpublished excluded)
    expect(typeof body.meta.requestId).toBe("string");
    expect(body.meta.page.pageSize).toBe(3);
    expect(body.meta.page.nextCursor).toBeNull();
  });

  it("returns a single published course on detail", async () => {
    const { status, body } = await get(`/public/orgs/${NOVA}/courses/${E01}`);
    expect(status).toBe(200);
    expect(body.data.id).toBe(E01);
  });

  it("filters by level, format and q", async () => {
    expect((await get(`/public/orgs/${NOVA}/courses?level=B1`)).body.data.length).toBe(1);
    expect((await get(`/public/orgs/${NOVA}/courses?format=online`)).body.data.length).toBe(1);
    expect((await get(`/public/orgs/${NOVA}/courses?q=ielts`)).body.data.length).toBe(1);
    expect((await get(`/public/orgs/${NOVA}/courses?q=zzz`)).body.data.length).toBe(0);
  });

  it("paginates deterministically by code with an opaque cursor", async () => {
    const p1 = await get(`/public/orgs/${NOVA}/courses?limit=1`);
    expect(p1.body.data.length).toBe(1);
    expect(p1.body.data[0].code).toBe("ENG-A2"); // first by ascending code
    const cur = p1.body.meta.page.nextCursor;
    expect(cur).toBeTruthy();
    const p2 = await get(`/public/orgs/${NOVA}/courses?limit=1&cursor=${encodeURIComponent(cur)}`);
    expect(p2.body.data[0].code).toBe("ENG-B1"); // strictly next
    expect(p2.body.data[0].id).not.toBe(p1.body.data[0].id);
  });

  it("supports conditional GET (ETag → 304)", async () => {
    const first = await get(`/public/orgs/${NOVA}/courses`);
    const etag = first.res.headers.get("etag")!;
    const second = await fetch(`${base}/public/orgs/${NOVA}/courses`, {
      headers: { "if-none-match": etag },
    });
    expect(second.status).toBe(304);
  });
});

describe("public catalog — negative", () => {
  it("unknown organization → 404", async () => {
    const { status, body } = await get(`/public/orgs/does-not-exist/courses`);
    expect(status).toBe(404);
    expect(body.error.code).toBe("not_found");
  });

  it("unpublished course → 404 (never visible)", async () => {
    expect((await get(`/public/orgs/${NOVA}/courses/${E04}`)).status).toBe(404);
  });

  it("cross-org: a Lumen course is not reachable under the Nova org", async () => {
    expect((await get(`/public/orgs/${NOVA}/courses/${F01}`)).status).toBe(404);
  });

  it("malformed input → 422 validation", async () => {
    expect((await get(`/public/orgs/${NOVA}/courses?limit=0`)).status).toBe(422);
    expect((await get(`/public/orgs/${NOVA}/courses?limit=999`)).status).toBe(422);
    expect((await get(`/public/orgs/${NOVA}/courses?limit=abc`)).status).toBe(422);
    expect((await get(`/public/orgs/${NOVA}/courses?level=Z9`)).status).toBe(422);
    expect((await get(`/public/orgs/${NOVA}/courses?cursor=!!!notbase64`)).status).toBe(422);
  });

  it("unknown path / non-GET → 404", async () => {
    expect((await get(`/api/v1/nope`)).status).toBe(404);
    const post = await fetch(`${base}/public/orgs/${NOVA}/courses`, { method: "POST" });
    expect(post.status).toBe(404);
  });

  it("forged principal/org headers have NO effect (public surface ignores them)", async () => {
    const clean = await get(`/public/orgs/${NOVA}/courses`);
    const forged = await get(`/public/orgs/${NOVA}/courses`, {
      "x-principal": "org-admin",
      "x-org": LUMEN,
      "x-org-id": "00000000-0000-4000-8000-000000000002",
      authorization: "Bearer forged",
    });
    expect(forged.status).toBe(200);
    expect(forged.body.data.map((c: { id: string }) => c.id)).toEqual(
      clean.body.data.map((c: { id: string }) => c.id),
    );
  });
});

describe("public catalog — leakage / allowlist", () => {
  it("service allowlist equals the contract allowlist", () => {
    expect([...PUBLIC_FIELDS]).toEqual([...PUBLIC_COURSE_FIELDS]);
  });

  it("every returned course exposes ONLY allowlisted fields (no internal/private data)", async () => {
    const list = (await get(`/public/orgs/${NOVA}/courses`)).body.data as Record<string, unknown>[];
    const detail = (await get(`/public/orgs/${NOVA}/courses/${E01}`)).body.data as Record<string, unknown>;
    const allowed = new Set<string>(PUBLIC_COURSE_FIELDS as readonly string[]);
    for (const c of [...list, detail]) {
      expect(new Set(Object.keys(c))).toEqual(allowed);
      // Explicitly assert internal / private / cross-domain fields are absent.
      for (const forbidden of ["orgId", "brandId", "published", "learnerId", "enrollmentId", "attempt", "evidence", "score"]) {
        expect(c).not.toHaveProperty(forbidden);
      }
    }
  });

  it("no learner/enrollment/attempt/evidence substrings anywhere in a public payload", async () => {
    const raw = JSON.stringify((await get(`/public/orgs/${NOVA}/courses`)).body);
    for (const term of ["learner", "enrollment", "attempt", "evidence", "guardian", "principal", "brandId", "orgId"]) {
      expect(raw.toLowerCase()).not.toContain(term.toLowerCase());
    }
  });
});

describe("public catalog — throttling", () => {
  it("returns 429 once the per-client window is exceeded", async () => {
    const limited = createCatalogServer({ rateLimit: { windowMs: 10_000, max: 2 } });
    await new Promise<void>((r) => limited.listen(0, "127.0.0.1", r));
    const { port } = limited.address() as AddressInfo;
    const u = `http://127.0.0.1:${port}/api/v1/public/orgs/${NOVA}/courses`;
    const codes = [await fetch(u), await fetch(u), await fetch(u)].map((r) => r.status);
    expect(codes[0]).toBe(200);
    expect(codes[2]).toBe(429);
    await new Promise<void>((r) => limited.close(() => r()));
  });
});
