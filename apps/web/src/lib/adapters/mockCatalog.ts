import type {
  CatalogPage,
  CatalogPageRequest,
  CatalogPort,
  CourseFilter,
  PublicCourse,
} from "@ogc/contracts";
import { courses } from "../../fixtures/catalog";
import type { Course } from "@ogc/contracts";

const latency = <T>(v: T, ms = 100): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Project the internal Course to the PUBLIC view model — internal fields (orgId,
// brandId) never cross this boundary.
function toPublic(c: Course): PublicCourse {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    level: c.level,
    format: c.format,
    durationWeeks: c.durationWeeks,
    objectives: [...c.objectives],
  };
}

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

// Composite (code, id) cursor — stable even when two courses share a code.
const SEP = "\u0000";
function encodeCursor(c: Course): string {
  return btoa(`${c.code}${SEP}${c.id}`);
}
function decodeCursor(cursor: string): { code: string; id: string } {
  let raw: string;
  try {
    raw = atob(cursor);
  } catch {
    throw new Error("invalid cursor");
  }
  const i = raw.indexOf(SEP);
  if (i < 0) throw new Error("invalid cursor");
  return { code: raw.slice(0, i), id: raw.slice(i + 1) };
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error("invalid limit");
  return limit;
}

export const mockCatalog: CatalogPort = {
  // async so a validation throw (bad cursor/limit) surfaces as a rejected promise.
  listCourses: async (orgId, filter, page?: CatalogPageRequest): Promise<CatalogPage> => {
    const limit = clampLimit(page?.limit);
    const after = page?.cursor ? decodeCursor(page.cursor) : null;

    let rows = courses
      .filter((c) => c.orgId === orgId && matches(c, filter)) // org-scoped
      .sort((a, b) =>
        a.code < b.code ? -1 : a.code > b.code ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );

    if (after)
      rows = rows.filter((c) => c.code > after.code || (c.code === after.code && c.id > after.id));

    const slice = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? encodeCursor(slice[slice.length - 1]) : null;
    return latency({ items: slice.map(toPublic), nextCursor });
  },

  // Org-scoped detail: a course id from another tenant is not resolvable (returns null).
  getCourse: (orgId, courseId): Promise<PublicCourse | null> => {
    const c = courses.find((x) => x.id === courseId && x.orgId === orgId);
    return latency(c ? toPublic(c) : null);
  },
};
