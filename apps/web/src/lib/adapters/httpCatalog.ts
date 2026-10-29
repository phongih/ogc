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
  defaultOrgSlug: string;
}

function config(): CatalogConfig {
  const g = (globalThis as unknown as { __OGC_CATALOG__?: Partial<CatalogConfig> }).__OGC_CATALOG__;
  const base = g?.base ?? (import.meta.env.VITE_CATALOG_API_BASE as string | undefined) ?? "http://127.0.0.1:8787/api/v1";
  const defaultOrgSlug = g?.defaultOrgSlug ?? (import.meta.env.VITE_CATALOG_ORG_SLUG as string | undefined) ?? "nova-learning";
  return { base, defaultOrgSlug };
}

// Explicit org context → public org slug. Falls back to the configured public org only
// when the id is unknown to the directory (still an explicit, non-authoritative mapping).
function slugForOrg(orgId: string, fallback: string): string {
  return organizations.find((o) => o.id === orgId)?.slug ?? fallback;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export const httpCatalog: CatalogPort = {
  async listCourses(orgId: string, filter?: CourseFilter, page?: CatalogPageRequest): Promise<CatalogPage> {
    const { base, defaultOrgSlug } = config();
    const slug = slugForOrg(orgId, defaultOrgSlug);
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
    const { base, defaultOrgSlug } = config();
    const slug = slugForOrg(orgId, defaultOrgSlug);
    const { status, body } = await getJson(
      `${base}/public/orgs/${encodeURIComponent(slug)}/courses/${encodeURIComponent(courseId)}`,
    );
    if (status === 404) return null;
    if (status !== 200) throw new Error(`catalog detail failed: ${status}`);
    return (body as { data: PublicCourse }).data;
  },
};
