import { afterEach, describe, expect, it, vi } from "vitest";
import { httpCatalog } from "./httpCatalog";
import { organizations } from "../../fixtures/directory";

const NOVA = organizations[0].id; // known → slug "nova-learning"
const LUMEN = organizations[1].id; // known → slug "lumen-edu"
const UNKNOWN = "00000000-0000-4000-8000-0000000unkn0";

function mockFetch(status: number, body: unknown) {
  const spy = vi.fn(
    async (..._args: unknown[]) => ({ status, json: async () => body }) as unknown as Response,
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

afterEach(() => vi.restoreAllMocks());

describe("httpCatalog — unknown-org fail-closed (AUTH-008-R1)", () => {
  it("getCourse on an UNKNOWN org returns null WITHOUT any request", async () => {
    const spy = mockFetch(200, {});
    const result = await httpCatalog.getCourse(UNKNOWN, "any-course");
    expect(result).toBeNull();
    expect(spy).not.toHaveBeenCalled(); // never reaches a default organization
  });

  it("listCourses on an UNKNOWN org returns an empty page WITHOUT any request", async () => {
    const spy = mockFetch(200, {});
    const page = await httpCatalog.listCourses(UNKNOWN);
    expect(page).toEqual({ items: [], nextCursor: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it("a known org resolves to ITS OWN slug (no default substitution)", async () => {
    const spy = mockFetch(200, { data: [], meta: { page: { nextCursor: null } } });
    await httpCatalog.listCourses(NOVA);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("/orgs/nova-learning/courses");

    const spy2 = mockFetch(200, { data: [], meta: { page: { nextCursor: null } } });
    await httpCatalog.listCourses(LUMEN);
    expect(String(spy2.mock.calls[0][0])).toContain("/orgs/lumen-edu/courses");
  });

  it("known org + foreign/missing course id → not found (null), not a fallback", async () => {
    const spy = mockFetch(404, {
      error: { code: "not_found", message: "Course not found", retryable: false },
      meta: { requestId: "x" },
    });
    const result = await httpCatalog.getCourse(NOVA, "foreign-course-id");
    expect(result).toBeNull();
    expect(String(spy.mock.calls[0][0])).toContain("/orgs/nova-learning/courses/foreign-course-id");
  });

  it("switching org targets a different slug each time (no cross-org reuse at the adapter)", async () => {
    const a = mockFetch(200, { data: [], meta: { page: { nextCursor: null } } });
    await httpCatalog.getCourse(NOVA, "c1");
    const novaUrl = String(a.mock.calls[0][0]);
    const b = mockFetch(200, { data: [], meta: { page: { nextCursor: null } } });
    await httpCatalog.getCourse(LUMEN, "c1");
    const lumenUrl = String(b.mock.calls[0][0]);
    expect(novaUrl).toContain("nova-learning");
    expect(lumenUrl).toContain("lumen-edu");
    expect(novaUrl).not.toEqual(lumenUrl);
  });
});
