/*
 * OGC Platform API (ADR-040). Request pipeline, in order:
 *   request id → grant resolve at IIOS (fail-closed) → authorize() from @ogc/contracts (the same
 *   evaluator the demo runs) → handler inside the DAK (one tenant-scoped transaction) → audit.
 *
 * Headers: `Authorization: Bearer <IIOS grant>` and `X-OGC-Org: <organization id>` (the tenant the
 * caller intends to act in — IIOS decides whether the grant covers it). Writes also need
 * `Idempotency-Key`.
 */
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { sql } from "kysely";
import {
  POLICY_CATALOG,
  authorize,
  roleHolds,
  type AuthzDecision,
  type AuthzResource,
  type IiosGrantedContext,
  type PolicyAction,
  type CredentialVerifier,
} from "@ogc/contracts";
import { audit, type AuditEntry } from "./audit.js";
import { withTenant, type Db, type TenantTx } from "./db.js";
import { idempotent, KEY_FORMAT } from "./idempotency.js";
import type { IiosClient } from "./iios.js";
import { registerAccess } from "./domains/access.js";
import { registerAdmissions } from "./domains/admissions.js";
import { registerBilling } from "./domains/billing.js";
import { registerPartners } from "./domains/partners.js";
import { registerCourses } from "./domains/courses.js";
import { registerClassCourses } from "./domains/classCourses.js";
import { registerStudents } from "./domains/students.js";
import { registerEngine } from "./domains/engine.js";
import { registerGrowth } from "./domains/growth.js";
import { registerShowcase, shownCount } from "./domains/showcase.js";
import { registerBrand } from "./domains/brand.js";
import { registerRewards } from "./domains/rewards.js";
import { fakeCredly } from "./credentials.js";
import { registerAttendance } from "./domains/attendance.js";
import { registerMakeup } from "./domains/makeup.js";
import { registerWorkforce } from "./domains/workforce.js";
import { registerSchedule } from "./domains/schedule.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare module "fastify" {
  interface FastifyRequest {
    grant: IiosGrantedContext | null;
  }
  interface FastifyContextConfig {
    public?: boolean; // no grant needed (health, dev login, /join, the public showcase)
  }
}

export interface ApiDeps {
  db: Db;
  iios: IiosClient;
  logger?: boolean;
  now?: () => number; // ms; injectable for tests
  /**
   * Staging only: expose the mock IIOS's dev login (persona picker) at /v1/dev/*. Off unless set;
   * main.ts refuses it with NODE_ENV=production. Synthetic principals only (ADR-040 §6).
   */
  devLogin?: boolean;
  /** Badge registers (staging: the fake Credly only — a real one is later work behind a gate). */
  credentials?: CredentialVerifier[];
}

/** What a route handler gets: the decided grant and helpers bound to it. */
export interface Caller {
  ctx: IiosGrantedContext;
  requestId: string;
  now: () => number;
  /** The decision, without replying: a denial is audited. */
  decide(action: PolicyAction, res: Omit<AuthzResource, "orgId">): Promise<AuthzDecision>;
  /** Allowed → the read-only fields; denied → audited and a 403 is sent (returns null). */
  authorize(action: PolicyAction, res: Omit<AuthzResource, "orgId">): Promise<string[] | null>;
  /** One tenant-scoped transaction (RLS on `ctx.orgId`). */
  tenant<T>(fn: (tx: TenantTx) => Promise<T>): Promise<T>;
  /** A write: idempotency key checked, work + audit + stored result in one transaction. */
  write<T>(
    route: string,
    body: unknown,
    work: (tx: TenantTx) => Promise<{ status: number; body: T; audit: AuditEntry }>,
  ): Promise<void>;
}

export type Handler = (
  caller: Caller,
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Api = FastifyInstance & {
  /** Register a route that needs a decided grant; the handler gets a `Caller`. */
  secured: (method: Method, url: string, h: Handler, opts?: { bodyLimit?: number }) => void;
};

export function buildApi(deps: ApiDeps): Api {
  const fastify = Fastify({
    logger: deps.logger ?? false,
    bodyLimit: 64 * 1024,
    genReqId: () => randomUUID(),
    // nginx on the same machine proxies /v1: trust its X-Forwarded-For (rate limits of /join)
    trustProxy: ["127.0.0.1", "::1"],
  });
  const app = fastify as unknown as Api;
  app.decorateRequest("grant", null);

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    reply.header("cache-control", "no-store");
  });

  // Grant resolution for every non-public route. Fail-closed.
  app.addHook("preHandler", async (req, reply) => {
    if (req.routeOptions.config.public) return;
    const h = req.headers.authorization ?? "";
    const grant = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    const org = String(req.headers["x-ogc-org"] ?? "");
    if (!grant) return reply.code(401).send({ error: "iios_denied", state: "missing" });
    if (!UUID.test(org)) return reply.code(400).send({ error: "bad_org_header" });
    const r = await deps.iios.resolve(grant, org);
    if (r.kind === "unavailable") {
      req.log.warn({ detail: r.detail }, "iios unavailable — refusing");
      return reply.code(503).send({ error: "iios_unavailable" });
    }
    if (r.kind === "denied") return reply.code(401).send({ error: "iios_denied", state: r.state });
    req.grant = r.context;
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err }, "unhandled");
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? "internal" : "bad_request" });
  });

  app.secured = (method, url, h, opts) => {
    app.route({
      method,
      url,
      ...(opts?.bodyLimit ? { bodyLimit: opts.bodyLimit } : {}),
      handler: async (req, reply) => {
        const ctx = req.grant;
        if (!ctx) return reply.code(401).send({ error: "iios_denied", state: "missing" });
        const scope = { orgId: ctx.orgId, principalId: ctx.principalId, requestId: req.id };
        const caller: Caller = {
          ctx,
          requestId: req.id,
          now: deps.now ?? Date.now,
          tenant: (fn) => withTenant(deps.db, scope, fn),
          async decide(action, res) {
            const d = authorize(ctx, action, { orgId: ctx.orgId, ...res });
            if (!d.allow)
              await withTenant(deps.db, scope, (tx) =>
                audit(tx, ctx, req.id, {
                  action,
                  resource: { ...res },
                  outcome: "denied",
                  reason: d.reason,
                }),
              );
            return d;
          },
          async authorize(action, res) {
            const d = await caller.decide(action, res);
            if (d.allow) return d.readonly;
            await reply.code(403).send({ error: "forbidden", reason: d.reason });
            return null;
          },
          async write(route, body, work) {
            const key = String(req.headers["idempotency-key"] ?? "");
            if (!KEY_FORMAT.test(key)) {
              await reply.code(400).send({ error: "idempotency_key_required" });
              return;
            }
            const out = await withTenant(deps.db, scope, (tx) =>
              idempotent(
                tx,
                { orgId: ctx.orgId, principalId: ctx.principalId, key, route, body },
                async () => {
                  const w = await work(tx);
                  await audit(tx, ctx, req.id, w.audit);
                  return { status: w.status, body: w.body };
                },
              ),
            );
            if (out.kind === "conflict")
              await reply.code(409).send({ error: "idempotency_key_reused" });
            else {
              if (out.kind === "replay") reply.header("idempotent-replay", "true");
              await reply.code(out.status).send(out.body);
            }
          },
        };
        return h(caller, req, reply);
      },
    });
  };

  // ── routes ────────────────────────────────────────────────────────────────────────────────
  app.get("/v1/health", { config: { public: true } }, async (_req, reply) => {
    try {
      await sql`select 1`.execute(deps.db);
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  // What the caller may do (for the UI's hints); enforcement stays per route.
  app.secured("GET", "/v1/me/access", async ({ ctx }) => {
    const n = ctx.narrowing ?? { state: "none" as const };
    const allowed = POLICY_CATALOG.map((c) => c.action).filter(
      (a) =>
        roleHolds(ctx.role, a) &&
        n.state !== "unavailable" &&
        (n.state === "none" || n.rules.some((r) => r.action === a)),
    );
    return {
      orgId: ctx.orgId,
      principalId: ctx.principalId,
      role: ctx.role,
      orgAdmin: ctx.orgAdmin ?? false,
      activeCenter: ctx.activeCenter ?? null,
      narrowing:
        n.state === "policy"
          ? {
              state: "policy",
              policyRef: n.policyRef,
              version: n.version,
              name: n.name,
              rules: n.rules,
            }
          : n,
      allowed,
    };
  });

  if (deps.devLogin) {
    const dev = deps.iios.dev;
    if (!dev) throw new Error("api: devLogin needs an IIOS client with dev endpoints");
    app.get("/v1/dev/personas", { config: { public: true } }, async (_req, reply) => {
      const m = await dev.members();
      return m ?? reply.code(503).send({ error: "iios_unavailable" });
    });
    app.post("/v1/dev/login", { config: { public: true } }, async (req, reply) => {
      const b = (req.body ?? {}) as { principalId?: unknown; orgId?: unknown };
      if (typeof b.principalId !== "string" || typeof b.orgId !== "string" || !UUID.test(b.orgId))
        return reply.code(400).send({ error: "bad_request" });
      const g = await dev.issue(b.principalId, b.orgId);
      return g ? { ...g, orgId: b.orgId } : reply.code(404).send({ error: "not_a_member" });
    });
  }

  registerSchedule(app);
  registerAttendance(app);
  registerMakeup(app);
  registerWorkforce(app);
  registerAdmissions(app);
  registerBilling(app);
  registerPartners(app);
  registerCourses(app);
  registerClassCourses(app);
  registerStudents(app);
  registerEngine(app);
  registerGrowth(app, deps.db, deps.now ?? Date.now);
  registerShowcase(app, deps.db, deps.now ?? Date.now);
  registerBrand(app, deps.db, deps.now ?? Date.now, deps.credentials ?? [fakeCredly], (tx) =>
    shownCount(tx, (deps.now ?? Date.now)()),
  );
  registerRewards(app);
  registerAccess(app, deps.iios);
  return app;
}
