import type { CatalogPort, Course, CourseFilter, PublicCourse } from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";

/*
 * HTTP Catalog adapter — talks to the local public Catalog backend (@ogc/catalog-api)
 * over REST JSON. It is a drop-in for CatalogPort alongside the mock adapter; selection
 * is dev-config only (see lib/api/index.ts). The backend is a PUBLIC surface: this
 * adapter sends NO principal/org/auth context (none would be trusted anyway).
 */
interface CatalogConfig {
  base: string; // e.g. http://127.0.0.1:8787/api/v1
  defaultOrgSlug: string;
}

function config(): CatalogConfig {
  const g = (globalThis as unknown as { __OGC_CATALOG__?: Partial<CatalogConfig> }).__OGC_CATALOG__;
  const base =
    g?.base ?? (import.meta.env.VITE_CATALOG_API_BASE as string | undefined) ?? "http://127.0.0.1:8787/api/v1";
  const defaultOrgSlug =
    g?.defaultOrgSlug ?? (import.meta.env.VITE_CATALOG_ORG_SLUG as string | undefined) ?? "nova-learning";
  return { base, defaultOrgSlug };
}

function slugForOrg(orgId: string, fallback: string): string {
  return organizations.find((o) => o.id === orgId)?.slug ?? fallback;
}

// The public DTO carries no orgId/brandId. The UI Course type does; we fill orgId from
// the request context and leave brandId empty (it is intentionally not public).
function toCourse(p: PublicCourse, orgId: string): Course {
  return { id: p.id, orgId, brandId: "", code: p.code, title: p.title, level: p.level, format: p.format, durationWeeks: p.durationWeeks, objectives: p.objectives };
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export const httpCatalog: CatalogPort = {
  async listCourses(orgId: string, filter?: CourseFilter): Promise<Course[]> {
    const { base, defaultOrgSlug } = config();
    const slug = slugForOrg(orgId, defaultOrgSlug);
    const out: Course[] = [];
    let cursor: string | null = null;
    // Follow cursor pages until exhausted (fixtures are small; guard against runaway).
    for (let guard = 0; guard < 50; guard++) {
      const qs = new URLSearchParams();
      if (filter?.level) qs.set("level", filter.level);
      if (filter?.format) qs.set("format", filter.format);
      if (filter?.q) qs.set("q", filter.q);
      qs.set("limit", "50");
      if (cursor) qs.set("cursor", cursor);
      const { status, body } = await getJson(`${base}/public/orgs/${encodeURIComponent(slug)}/courses?${qs}`);
      if (status !== 200) throw new Error(`catalog list failed: ${status}`);
      const b = body as { data: PublicCourse[]; meta: { page?: { nextCursor: string | null } } };
      for (const c of b.data) out.push(toCourse(c, orgId));
      cursor = b.meta.page?.nextCursor ?? null;
      if (!cursor) break;
    }
    return out;
  },

  async getCourse(courseId: string): Promise<Course | null> {
    const { base, defaultOrgSlug } = config();
    const { status, body } = await getJson(
      `${base}/public/orgs/${encodeURIComponent(defaultOrgSlug)}/courses/${encodeURIComponent(courseId)}`,
    );
    if (status === 404) return null;
    if (status !== 200) throw new Error(`catalog detail failed: ${status}`);
    const b = body as { data: PublicCourse };
    // orgId filled from the configured public org (detail endpoint is org-scoped by slug).
    const org = organizations.find((o) => o.slug === defaultOrgSlug);
    return toCourse(b.data, org?.id ?? "");
  },
};
