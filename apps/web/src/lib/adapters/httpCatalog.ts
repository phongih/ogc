import type {
  CatalogPage,
  CatalogPageRequest,
  CatalogPort,
  CourseFilter,
  PublicCourse,
} from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";

/*
 * HTTP Catalog adapter — talks to the local public Catalog backend (@ogc/catalog-api)
 * over REST JSON. It returns the PUBLIC view model (PublicCourse) directly: no internal
 * fields are fabricated. Pagination is EXPLICIT — one request returns one page and its
 * nextCursor; the UI drives further pages. The backend is a PUBLIC surface, so this
 * adapter sends NO principal/org/auth context (none would be trusted anyway).
 */
interface CatalogConfig {
  base: string;
}

function config(): CatalogConfig {
  const g = (globalThis as unknown as { __OGC_CATALOG__?: Partial<CatalogConfig> }).__OGC_CATALOG__;
  const base = g?.base ?? (import.meta.env.VITE_CATALOG_API_BASE as string | undefined) ?? "http://127.0.0.1:8787/api/v1";
  return { base };
}

// Explicit, deterministic orgId → public org slug via the directory. FAIL-CLOSED:
// an unknown orgId resolves to null and NEVER falls back to a default organization,
// so a bad/unknown id can never reach another tenant's public catalog.
function slugForOrg(orgId: string): string | null {
  return organizations.find((o) => o.id === orgId)?.slug ?? null;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export const httpCatalog: CatalogPort = {
  async listCourses(orgId: string, filter?: CourseFilter, page?: CatalogPageRequest): Promise<CatalogPage> {
    const slug = slugForOrg(orgId);
    // Fail-closed: unknown org → empty page, and NO request is issued to any backend.
    if (slug === null) return { items: [], nextCursor: null };
    const { base } = config();
    const qs = new URLSearchParams();
    if (filter?.level) qs.set("level", filter.level);
    if (filter?.format) qs.set("format", filter.format);
    if (filter?.q) qs.set("q", filter.q);
    if (page?.limit !== undefined) qs.set("limit", String(page.limit));
    if (page?.cursor) qs.set("cursor", page.cursor);
    const { status, body } = await getJson(
      `${base}/public/orgs/${encodeURIComponent(slug)}/courses?${qs.toString()}`,
    );
    if (status !== 200) throw new Error(`catalog list failed: ${status}`);
    const b = body as { data: PublicCourse[]; meta: { page?: { nextCursor: string | null } } };
    return { items: b.data, nextCursor: b.meta.page?.nextCursor ?? null };
  },

  async getCourse(orgId: string, courseId: string): Promise<PublicCourse | null> {
    const slug = slugForOrg(orgId);
    // Fail-closed: unknown org → not found, and NO request is issued.
    if (slug === null) return null;
    const { base } = config();
    const { status, body } = await getJson(
      `${base}/public/orgs/${encodeURIComponent(slug)}/courses/${encodeURIComponent(courseId)}`,
    );
    if (status === 404) return null;
    if (status !== 200) throw new Error(`catalog detail failed: ${status}`);
    return (body as { data: PublicCourse }).data;
  },
};
