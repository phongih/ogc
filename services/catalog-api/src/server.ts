import http from "node:http";
import { randomUUID, createHash } from "node:crypto";
import {
  getPublicCourse,
  listPublicCourses,
  resolveOrg,
  ValidationError,
  type ListQuery,
} from "./catalog.js";

export interface ServerOptions {
  // Fixed-window throttle per client address. null disables (used by tests).
  rateLimit?: { windowMs: number; max: number } | null;
}

const DEFAULT_RATE = { windowMs: 10_000, max: 240 };

type Json = Record<string, unknown>;

function send(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: Json,
  requestId: string,
) {
  const payload = JSON.stringify(body);
  // ETag is computed over the STABLE content only (data + page), never the volatile
  // per-request requestId — otherwise conditional GET could never match.
  const meta = body.meta as { page?: unknown } | undefined;
  const basis = JSON.stringify({ data: body.data ?? null, page: meta?.page ?? null });
  const etag = `"${createHash("sha256").update(basis).digest("base64url").slice(0, 27)}"`;
  // Conditional GET: unchanged body → 304.
  if (status === 200 && req.headers["if-none-match"] === etag) {
    res.writeHead(304, {
      ETag: etag,
      "x-request-id": requestId,
      "access-control-allow-origin": "*",
    });
    res.end();
    return;
  }
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=30",
    ETag: etag,
    "x-request-id": requestId,
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
  });
  res.end(payload);
}

function ok(data: unknown, requestId: string, page?: Json): Json {
  const meta: Json = { requestId };
  if (page) meta.page = page;
  return { data, meta };
}
function err(code: string, message: string, retryable: boolean, requestId: string): Json {
  return { error: { code, message, retryable }, meta: { requestId } };
}

export function createCatalogServer(opts: ServerOptions = {}): http.Server {
  const rate = opts.rateLimit === undefined ? DEFAULT_RATE : opts.rateLimit;
  const hits = new Map<string, { count: number; resetAt: number }>();

  function throttled(addr: string): boolean {
    if (!rate) return false;
    const now = Date.now();
    const cur = hits.get(addr);
    if (!cur || now >= cur.resetAt) {
      hits.set(addr, { count: 1, resetAt: now + rate.windowMs });
      return false;
    }
    cur.count += 1;
    return cur.count > rate.max;
  }

  return http.createServer((req, res) => {
    const requestId = randomUUID();

    // IMPORTANT: the server NEVER reads any client-supplied principal/org/auth header.
    // This is a public surface; forged x-principal / x-org headers have no effect.

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "if-none-match, content-type",
      });
      res.end();
      return;
    }
    if (req.method !== "GET") {
      send(req, res, 404, err("not_found", "Not found", false, requestId), requestId);
      return;
    }

    const addr = req.socket.remoteAddress ?? "unknown";
    if (throttled(addr)) {
      send(req, res, 429, err("rate_limited", "Too many requests", true, requestId), requestId);
      return;
    }

    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      send(req, res, 404, err("not_found", "Not found", false, requestId), requestId);
      return;
    }

    // Routes:
    //   GET /api/v1/public/orgs/:slug/courses
    //   GET /api/v1/public/orgs/:slug/courses/:courseId
    const m = url.pathname.match(
      /^\/api\/v1\/public\/orgs\/([^/]+)\/courses(?:\/([^/]+))?\/?$/,
    );
    if (!m) {
      send(req, res, 404, err("not_found", "Not found", false, requestId), requestId);
      return;
    }

    const slug = decodeURIComponent(m[1]);
    const courseId = m[2] ? decodeURIComponent(m[2]) : null;
    const org = resolveOrg(slug);
    if (!org) {
      send(req, res, 404, err("not_found", "Organization not found", false, requestId), requestId);
      return;
    }

    try {
      if (courseId) {
        const course = getPublicCourse(org.orgId, courseId);
        if (!course) {
          send(req, res, 404, err("not_found", "Course not found", false, requestId), requestId);
          return;
        }
        send(req, res, 200, ok(course, requestId), requestId);
        return;
      }
      const query: ListQuery = {
        level: url.searchParams.get("level") ?? undefined,
        format: url.searchParams.get("format") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      };
      const result = listPublicCourses(org.orgId, query);
      send(
        req,
        res,
        200,
        ok(result.items, requestId, { nextCursor: result.nextCursor, pageSize: result.pageSize }),
        requestId,
      );
    } catch (e) {
      if (e instanceof ValidationError) {
        send(req, res, 422, err("validation", e.message, false, requestId), requestId);
        return;
      }
      send(req, res, 503, err("transient", "Temporary error", true, requestId), requestId);
    }
  });
}
