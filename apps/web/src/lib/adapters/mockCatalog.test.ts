import { describe, expect, it } from "vitest";
import { mockCatalog } from "./mockCatalog";
import { organizations } from "../../fixtures/directory";

const ORG = organizations[0].id;

describe("mockCatalog", () => {
  it("lists org-scoped courses", async () => {
    const all = await mockCatalog.listCourses(ORG);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => c.orgId === ORG)).toBe(true);
    // other org has no synthetic courses
    expect((await mockCatalog.listCourses(organizations[1].id)).length).toBe(0);
  });

  it("filters by level, format and query", async () => {
    expect((await mockCatalog.listCourses(ORG, { level: "B1" })).every((c) => c.level === "B1")).toBe(true);
    expect((await mockCatalog.listCourses(ORG, { format: "online" })).every((c) => c.format === "online")).toBe(true);
    const q = await mockCatalog.listCourses(ORG, { q: "ielts" });
    expect(q.length).toBe(1);
    expect(q[0].code).toBe("IELTS-B2");
  });

  it("returns a course or null", async () => {
    const [first] = await mockCatalog.listCourses(ORG);
    expect((await mockCatalog.getCourse(first.id))?.id).toBe(first.id);
    expect(await mockCatalog.getCourse("missing")).toBeNull();
  });
});
