import type { CatalogPort, Course, CourseFilter } from "@ogc/contracts";
import { courses } from "../../fixtures/catalog";

const latency = <T>(v: T, ms = 100): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

function matches(c: Course, f?: CourseFilter): boolean {
  if (!f) return true;
  if (f.level && c.level !== f.level) return false;
  if (f.format && c.format !== f.format) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!c.title.toLowerCase().includes(q) && !c.code.toLowerCase().includes(q)) return false;
  }
  return true;
}

export const mockCatalog: CatalogPort = {
  listCourses: (orgId, filter) =>
    latency(courses.filter((c) => c.orgId === orgId && matches(c, filter))),
  getCourse: (courseId) => latency(courses.find((c) => c.id === courseId) ?? null),
};
