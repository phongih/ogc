import { describe, expect, it } from "vitest";
import { mockCatalog } from "./mockCatalog";
import { organizations } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";

const ORG = organizations[0].id;
const ORG2 = organizations[1].id;
const PUBLIC_KEYS = ["id", "code", "title", "level", "format", "durationWeeks", "objectives"].sort();

describe("mockCatalog — public view model + pagination", () => {
  it("lists org-scoped public courses (no internal fields leak)", async () => {
    const page = await mockCatalog.listCourses(ORG, undefined, { limit: 50 });
    expect(page.items.length).toBeGreaterThan(0);
    for (const c of page.items) {
      expect(Object.keys(c).sort()).toEqual(PUBLIC_KEYS); // PublicCourse only
      expect(c).not.toHaveProperty("orgId");
      expect(c).not.toHaveProperty("brandId");
    }
    // org 2 has no synthetic courses in the web fixtures
    expect((await mockCatalog.listCourses(ORG2, undefined, { limit: 50 })).items.length).toBe(0);
  });

  it("filters by level, format and query", async () => {
    expect((await mockCatalog.listCourses(ORG, { level: "B1" }, { limit: 50 })).items.every((c) => c.level === "B1")).toBe(true);
    expect((await mockCatalog.listCourses(ORG, { format: "online" }, { limit: 50 })).items.every((c) => c.format === "online")).toBe(true);
    const q = await mockCatalog.listCourses(ORG, { q: "ielts" }, { limit: 50 });
    expect(q.items.length).toBe(1);
    expect(q.items[0].code).toBe("IELTS-B2");
  });

  it("paginates deterministically with an opaque cursor", async () => {
    const p1 = await mockCatalog.listCourses(ORG, undefined, { limit: 1 });
    expect(p1.items.length).toBe(1);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await mockCatalog.listCourses(ORG, undefined, { cursor: p1.nextCursor!, limit: 1 });
    expect(p2.items[0].id).not.toBe(p1.items[0].id);
  });

  it("rejects a malformed cursor", async () => {
    await expect(mockCatalog.listCourses(ORG, undefined, { cursor: "!!!notbase64!!!", limit: 1 })).rejects.toThrow();
  });

  it("returns an org-scoped course or null (cross-org id not resolvable)", async () => {
    const first = courses.find((c) => c.orgId === ORG)!;
    expect((await mockCatalog.getCourse(ORG, first.id))?.id).toBe(first.id);
    expect(await mockCatalog.getCourse(ORG, "missing")).toBeNull();
    // A course that exists but belongs to another org is NOT resolvable under ORG2.
    expect(await mockCatalog.getCourse(ORG2, first.id)).toBeNull();
  });
});
