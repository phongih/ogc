import { describe, expect, it } from "vitest";
import type { CatalogPort } from "@ogc/contracts";

/*
 * Transport-AGNOSTIC CatalogPort conformance cases. The same cases run against every
 * adapter (mock and http); each adapter supplies the data-specific facts below. The
 * cases assert contract invariants, never exact fixture counts, so no adapter needs a
 * weakening exception. Transport specifics (ETag, HTTP status, rate limit, CORS) are
 * NOT here — they live in the backend's own suite.
 */
export interface ConformanceFixture {
  name: string;
  port: CatalogPort;
  knownOrgId: string; // an org with ≥ 2 published courses
  otherKnownOrgId: string; // a different known org
  unknownOrgId: string; // an org id not in the directory
  // Optional: an id that exists internally but must NEVER be publicly visible
  // (published-only). Adapters whose data model has no such case omit it.
  unpublishedCourseId?: string;
}

const PUBLIC_KEYS = ["code", "durationWeeks", "format", "id", "level", "objectives", "title"];

async function drain(port: CatalogPort, orgId: string): Promise<string[]> {
  // Walk every page via the cursor; returns the ordered list of ids.
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 100; guard++) {
    const page = await port.listCourses(orgId, undefined, { cursor, limit: 1 });
    for (const c of page.items) ids.push(c.id);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return ids;
}

export function runCatalogConformance(fx: ConformanceFixture): void {
  describe(`CatalogPort conformance — ${fx.name}`, () => {
    it("1. unknown org is fail-closed (empty list, null detail)", async () => {
      const page = await fx.port.listCourses(fx.unknownOrgId);
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
      expect(await fx.port.getCourse(fx.unknownOrgId, "any-id")).toBeNull();
    });

    it("2. a course id does not resolve under a DIFFERENT organization", async () => {
      const page = await fx.port.listCourses(fx.knownOrgId, undefined, { limit: 1 });
      const foreignId = page.items[0].id;
      expect(await fx.port.getCourse(fx.otherKnownOrgId, foreignId)).toBeNull();
    });

    it("3. published-only visibility (where the data model has an unpublished id)", async () => {
      if (!fx.unpublishedCourseId) return; // adapter has no unpublished fixture — nothing to assert
      expect(await fx.port.getCourse(fx.knownOrgId, fx.unpublishedCourseId)).toBeNull();
      const ids = await drain(fx.port, fx.knownOrgId);
      expect(ids).not.toContain(fx.unpublishedCourseId);
    });

    it("4. only PublicCourse allowlist fields are exposed (no private leakage)", async () => {
      const page = await fx.port.listCourses(fx.knownOrgId, undefined, { limit: 50 });
      expect(page.items.length).toBeGreaterThan(0);
      for (const c of page.items) {
        expect(Object.keys(c).sort()).toEqual(PUBLIC_KEYS);
        for (const forbidden of ["orgId", "brandId", "published"]) expect(c).not.toHaveProperty(forbidden);
      }
      const detail = await fx.port.getCourse(fx.knownOrgId, page.items[0].id);
      expect(detail).not.toBeNull();
      expect(Object.keys(detail!).sort()).toEqual(PUBLIC_KEYS);
    });

    it("5. deterministic pagination with a stable composite (code,id) order", async () => {
      const first = await fx.port.listCourses(fx.knownOrgId, undefined, { limit: 50 });
      const ordered = first.items;
      // Non-decreasing by code, and (code,id) strictly increasing (unique, no dup/skip).
      for (let i = 1; i < ordered.length; i++) {
        const a = ordered[i - 1];
        const b = ordered[i];
        const inOrder = a.code < b.code || (a.code === b.code && a.id < b.id);
        expect(inOrder, `order at ${i}: ${a.code}/${a.id} < ${b.code}/${b.id}`).toBe(true);
      }
      // Two independent cursor traversals yield the same id sequence.
      const t1 = await drain(fx.port, fx.knownOrgId);
      const t2 = await drain(fx.port, fx.knownOrgId);
      expect(t1).toEqual(t2);
      expect(new Set(t1).size).toBe(t1.length); // no duplicates across pages
      expect(t1).toEqual(ordered.map((c) => c.id)); // paged order == single-page order
    });

    it("6. empty-page past the end and not-found detail", async () => {
      const all = await fx.port.listCourses(fx.knownOrgId, undefined, { limit: 50 });
      // Re-paginate to the end to obtain a terminal cursor, then one more page is empty.
      let cursor: string | undefined;
      for (let i = 0; i < all.items.length; i++) {
        const p = await fx.port.listCourses(fx.knownOrgId, undefined, { cursor, limit: 1 });
        cursor = p.nextCursor ?? undefined;
        if (!cursor) break;
      }
      if (cursor) {
        const beyond = await fx.port.listCourses(fx.knownOrgId, undefined, { cursor, limit: 1 });
        expect(beyond.items).toEqual([]);
        expect(beyond.nextCursor).toBeNull();
      }
      expect(await fx.port.getCourse(fx.knownOrgId, "definitely-not-a-course")).toBeNull();
    });

    it("7. filter behavior is equivalent across adapters", async () => {
      const byLevel = await fx.port.listCourses(fx.knownOrgId, { level: "B1" }, { limit: 50 });
      expect(byLevel.items.every((c) => c.level === "B1")).toBe(true);
      const byFormat = await fx.port.listCourses(fx.knownOrgId, { format: "online" }, { limit: 50 });
      expect(byFormat.items.every((c) => c.format === "online")).toBe(true);
      const byQ = await fx.port.listCourses(fx.knownOrgId, { q: "english" }, { limit: 50 });
      expect(byQ.items.every((c) => `${c.title} ${c.code}`.toLowerCase().includes("english"))).toBe(true);
      const none = await fx.port.listCourses(fx.knownOrgId, { q: "zzz-no-match-zzz" }, { limit: 50 });
      expect(none.items).toEqual([]);
    });
  });
}
