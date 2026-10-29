import { z } from "zod";
import { CourseLevel, CourseFormat } from "./catalog.js";

/*
 * PublicCourse — the EXPLICIT allowlisted public DTO for the catalog backend.
 * It is deliberately a SEPARATE type from the internal `Course` model: only the
 * fields below are ever exposed on the public (unauthenticated) catalog surface.
 * Internal fields (orgId, brandId, …) and all learner/enrollment/evidence data are
 * NOT part of this shape and must never appear in a public payload.
 */
export const PublicCourse = z
  .object({
    id: z.string().min(1),
    code: z.string().min(2),
    title: z.string().min(1),
    level: CourseLevel,
    format: CourseFormat,
    durationWeeks: z.number().int().positive(),
    objectives: z.array(z.string()),
  })
  .strict(); // reject unknown keys — guards against accidental field leakage
export type PublicCourse = z.infer<typeof PublicCourse>;

// The exact set of keys allowed on a PublicCourse. Used by the server to project
// internal courses and by leakage tests to assert nothing else is present.
export const PUBLIC_COURSE_FIELDS = [
  "id",
  "code",
  "title",
  "level",
  "format",
  "durationWeeks",
  "objectives",
] as const;

// ── Response envelope (public surface) ───────────────────────────────────────
export const PublicErrorCode = z.enum([
  "not_found",
  "validation",
  "rate_limited",
  "transient",
]);
export type PublicErrorCode = z.infer<typeof PublicErrorCode>;

export const CursorPageMeta = z.object({
  nextCursor: z.string().nullable(),
  pageSize: z.number().int().nonnegative(),
});
export type CursorPageMeta = z.infer<typeof CursorPageMeta>;

export const PublicMeta = z.object({
  requestId: z.string().min(1),
  page: CursorPageMeta.optional(),
});
export type PublicMeta = z.infer<typeof PublicMeta>;

export const PublicListResponse = z.object({
  data: z.array(PublicCourse),
  meta: PublicMeta,
});
export type PublicListResponse = z.infer<typeof PublicListResponse>;

// CatalogPage — the explicit pagination unit at the CatalogPort boundary (one page of
// the public catalog view model). The UI drives pagination with the opaque nextCursor.
export const CatalogPage = z.object({
  items: z.array(PublicCourse),
  nextCursor: z.string().nullable(),
});
export type CatalogPage = z.infer<typeof CatalogPage>;

export const PublicItemResponse = z.object({
  data: PublicCourse,
  meta: PublicMeta,
});
export type PublicItemResponse = z.infer<typeof PublicItemResponse>;

export const PublicErrorResponse = z.object({
  error: z.object({
    code: PublicErrorCode,
    message: z.string(),
    retryable: z.boolean(),
  }),
  meta: z.object({ requestId: z.string().min(1) }),
});
export type PublicErrorResponse = z.infer<typeof PublicErrorResponse>;
