import type { PublicCourse } from "@ogc/contracts"; // type-only: erased at runtime
import {
  courses,
  organizations,
  type CourseFormat,
  type CourseLevel,
  type InternalCourse,
} from "./fixtures.js";

// Exact public allowlist. Kept in sync with @ogc/contracts PUBLIC_COURSE_FIELDS
// (asserted equal in a test). Projection uses ONLY these keys — nothing else leaks.
export const PUBLIC_FIELDS = [
  "id",
  "code",
  "title",
  "level",
  "format",
  "durationWeeks",
  "objectives",
] as const;

const LEVELS: CourseLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const FORMATS: CourseFormat[] = ["in_center", "online", "hybrid"];

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_Q_LEN = 100;

export interface ListQuery {
  level?: string;
  format?: string;
  q?: string;
  cursor?: string;
  limit?: string;
}

export class ValidationError extends Error {}

// Project an internal course to the public DTO using ONLY the allowlist.
export function toPublicCourse(c: InternalCourse): PublicCourse {
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

export function resolveOrg(slug: string) {
  return organizations.find((o) => o.slug === slug) ?? null;
}

// Opaque, deterministic COMPOSITE cursor = base64url of "code\0id". The id tiebreaker
// keeps pagination stable even when two courses share the same `code`.
const SEP = "\u0000";
function encodeCursor(code: string, id: string): string {
  return Buffer.from(`${code}${SEP}${id}`, "utf8").toString("base64url");
}
function decodeCursor(cursor: string): { code: string; id: string } {
  const s = Buffer.from(cursor, "base64url").toString("utf8");
  const i = s.indexOf(SEP);
  // A valid cursor round-trips to "code\0id" with printable-ascii parts.
  if (i <= 0 || !/^[\x20-\x7e]+$/.test(s.replace(SEP, ""))) throw new ValidationError("invalid cursor");
  return { code: s.slice(0, i), id: s.slice(i + 1) };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (!/^\d+$/.test(raw)) throw new ValidationError("limit must be a positive integer");
  const n = Number(raw);
  if (n < 1 || n > MAX_LIMIT) throw new ValidationError(`limit must be between 1 and ${MAX_LIMIT}`);
  return n;
}

export interface ListResult {
  items: PublicCourse[];
  nextCursor: string | null;
  pageSize: number;
}

/*
 * Published, org-scoped, filtered, deterministically ordered + cursor-paginated.
 * Ordering (documented): ascending by `code` (stable, unique within org). The cursor
 * is the last returned course's code; the next page is strictly code > cursor.
 */
export function listPublicCourses(orgId: string, query: ListQuery): ListResult {
  const limit = parseLimit(query.limit);

  if (query.level !== undefined && !LEVELS.includes(query.level as CourseLevel))
    throw new ValidationError("invalid level");
  if (query.format !== undefined && !FORMATS.includes(query.format as CourseFormat))
    throw new ValidationError("invalid format");
  if (query.q !== undefined && query.q.length > MAX_Q_LEN)
    throw new ValidationError("q too long");

  const after = query.cursor !== undefined ? decodeCursor(query.cursor) : null;
  const q = (query.q ?? "").trim().toLowerCase();

  let rows = courses
    .filter((c) => c.orgId === orgId && c.published) // org-scoped + published only
    .filter((c) => (query.level ? c.level === query.level : true))
    .filter((c) => (query.format ? c.format === query.format : true))
    .filter((c) => (q ? c.title.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) : true))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (after !== null)
    rows = rows.filter((c) => c.code > after.code || (c.code === after.code && c.id > after.id));

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.length > limit ? encodeCursor(last.code, last.id) : null;
  return { items: page.map(toPublicCourse), nextCursor, pageSize: page.length };
}

// Public detail: only a published course in the given org. Otherwise null (→ 404).
export function getPublicCourse(orgId: string, courseId: string): PublicCourse | null {
  const c = courses.find((x) => x.id === courseId && x.orgId === orgId && x.published);
  return c ? toPublicCourse(c) : null;
}
