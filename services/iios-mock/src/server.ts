/*
 * MOCK IIOS server for the OGC Platform (ADR-040 §3.3) — dev / staging, synthetic data only.
 *
 * Plays the IIOS side of the handoff (23/11): issues sealed grants for synthetic principals,
 * resolves a presented grant to a DECIDED state + context, carries `orgAdmin` and `narrowing`,
 * and revokes. It holds the dev signing key; the OGC API holds only a client secret and calls
 * `resolve`. Replacing this with real IIOS changes the URL and credentials, not OGC's logic.
 *
 * Every endpoint requires the client secret (Authorization: Bearer <secret>). It refuses to start
 * without a key of at least 32 bytes and refuses NODE_ENV=production (see main.ts).
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { IiosGrantedContext, type IiosContextResolution } from "@ogc/contracts";
import {
  adminView,
  isOrgAdmin,
  memoryStore,
  narrowingFor,
  ops,
  type AdminCall,
  type PolicyRecord,
  type PolicyStore,
} from "./policies.js";
import { MEMBERS, ORGS, seedPolicies, type Member } from "./seed.js";
import { open, sign } from "./token.js";

export interface IiosMockOptions {
  key: Buffer; // dev signing key, ≥ 32 bytes
  clientId: string; // the one client allowed (OGC)
  clientSecret: string;
  now?: () => number; // ms, for tests
  /** Where policies live. Default: in memory (`state`); main.ts passes the PostgreSQL store. */
  store?: PolicyStore;
}

export interface IiosMockState {
  policies: Map<string, PolicyRecord>; // the memory store's data (unused with a PostgreSQL store)
  attachments: Map<string, string>; // principalId → policy ref
  revoked: Set<string>; // grant ids
}

const DEFAULT_TTL = 8 * 3600;
const MAX_TTL = 24 * 3600;

export function buildIiosMock(opts: IiosMockOptions): {
  app: FastifyInstance;
  state: IiosMockState;
} {
  if (opts.key.length < 32) throw new Error("iios-mock: signing key must be at least 32 bytes");
  const now = opts.now ?? Date.now;
  const state: IiosMockState = {
    policies: new Map(seedPolicies().map((p) => [p.ref, p])),
    attachments: new Map(),
    revoked: new Set(),
  };
  const store = opts.store ?? memoryStore(state);
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 });
  const secret = Buffer.from(opts.clientSecret);

  app.addHook("onRequest", async (req, reply) => {
    const h = req.headers.authorization ?? "";
    const got = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
    if (got.length !== secret.length || !timingSafeEqual(got, secret))
      return reply.code(401).send({ error: "client_unauthorized" });
  });

  const memberOf = (principalId: string, orgId: string): Member | undefined =>
    MEMBERS.find((m) => m.principalId === principalId && m.orgId === orgId);

  // Dev login: issue a grant for a synthetic member of the organization.
  app.post("/v1/dev/grants", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const principalId = typeof b.principalId === "string" ? b.principalId : "";
    const orgId = typeof b.orgId === "string" ? b.orgId : "";
    const ac = typeof b.activeCenter === "string" ? b.activeCenter : undefined;
    const ttl = typeof b.ttlSeconds === "number" ? b.ttlSeconds : DEFAULT_TTL;
    const m = memberOf(principalId, orgId);
    if (!m || m.role === null) return reply.code(404).send({ error: "not_a_member" });
    if (ac && !ORGS.find((o) => o.id === orgId)?.centers.some((c) => c.id === ac))
      return reply.code(422).send({ error: "unknown_center" });
    if (!(ttl > 0 && ttl <= MAX_TTL)) return reply.code(422).send({ error: "bad_ttl" });
    const iat = Math.floor(now() / 1000);
    const { token, payload } = sign(opts.key, {
      cid: opts.clientId,
      org: orgId,
      sub: principalId,
      purpose: "ogc.platform",
      ...(ac ? { ac } : {}),
      iat,
      exp: iat + ttl,
    });
    return { grant: token, expiresAt: new Date(payload.exp * 1000).toISOString() };
  });

  // The decision OGC consumes. Anything but "valid" carries no context.
  app.post("/v1/grants/resolve", async (req): Promise<IiosContextResolution> => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const p = open(opts.key, typeof b.grant === "string" ? b.grant : "");
    if (!p || p.cid !== opts.clientId) return { state: "missing" };
    if (state.revoked.has(p.jti)) return { state: "revoked" };
    if (p.exp * 1000 <= now()) return { state: "expired" };
    if (typeof b.intendedOrgId !== "string" || b.intendedOrgId !== p.org)
      return { state: "cross_tenant" };
    const m = memberOf(p.sub, p.org);
    if (!m || m.role === null) return { state: "revoked" }; // membership ended since issue
    const context = IiosGrantedContext.parse({
      clientId: p.cid,
      orgId: p.org,
      principalId: p.sub,
      role: m.role === "admin" ? "staff" : m.role,
      purpose: p.purpose,
      ...(p.ac ? { activeCenter: p.ac } : {}),
      orgAdmin: m.role === "admin",
      narrowing: narrowingFor(m, await store.read(m.orgId)),
      requestId: p.rid,
      grantRef: p.jti,
      expiresAt: new Date(p.exp * 1000).toISOString(),
    });
    return { state: "valid", context };
  });

  app.post("/v1/dev/grants/revoke", async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const p = open(opts.key, typeof b.grant === "string" ? b.grant : "");
    if (!p) return reply.code(422).send({ error: "bad_grant" });
    state.revoked.add(p.jti);
    return { ok: true };
  });

  // Dev login (staging): who may be picked. Synthetic members with a role, per organization.
  app.get("/v1/dev/members", async () =>
    MEMBERS.filter((m) => m.role !== null).map((m) => ({
      principalId: m.principalId,
      orgId: m.orgId,
      orgName: ORGS.find((o) => o.id === m.orgId)?.name ?? m.orgId,
      displayName: m.displayName,
      role: m.role,
    })),
  );

  // ── access policy administration (OGC-ADR-039 option C) ─────────────────────────────────
  // Called server-to-server by the OGC API with the CALLER'S grant. IIOS opens the grant itself
  // and decides admin from its own member data; a caller's flag is never trusted.
  const callerOf = (b: Record<string, unknown>): AdminCall | null => {
    const p = open(opts.key, typeof b.grant === "string" ? b.grant : "");
    if (!p || p.cid !== opts.clientId || state.revoked.has(p.jti) || p.exp * 1000 <= now())
      return null;
    if (typeof b.orgId !== "string" || b.orgId !== p.org) return null;
    const m = memberOf(p.sub, p.org);
    if (!m || m.role === null) return null;
    return {
      viewer: p.sub,
      orgId: p.org,
      nowIso: new Date(now()).toISOString(),
      newRef: () => `policy-${randomUUID().slice(0, 8)}`,
    };
  };
  const body = (req: { body: unknown }) => (req.body ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : -1);

  app.post("/v1/admin/policies/view", async (req, reply) => {
    const c = callerOf(body(req));
    if (!c) return reply.code(401).send({ error: "grant" });
    if (!isOrgAdmin(c.viewer, c.orgId)) return reply.code(403).send({ error: "not_admin" });
    return adminView(await store.read(c.orgId), c.viewer, c.orgId);
  });
  app.post("/v1/admin/policies/create", async (req, reply) => {
    const b = body(req);
    const c = callerOf(b);
    if (!c) return reply.code(401).send({ error: "grant" });
    const input = (b.input ?? {}) as Parameters<typeof ops.create>[2];
    return store.write(c.orgId, (s) => ops.create(s, c, input));
  });
  app.post("/v1/admin/policies/revise", async (req, reply) => {
    const b = body(req);
    const c = callerOf(b);
    if (!c) return reply.code(401).send({ error: "grant" });
    const patch = (b.patch ?? {}) as Parameters<typeof ops.revise>[4];
    return store.write(c.orgId, (s) =>
      ops.revise(s, c, String(b.ref ?? ""), num(b.expectedVersion), patch),
    );
  });
  app.post("/v1/admin/policies/retire", async (req, reply) => {
    const b = body(req);
    const c = callerOf(b);
    if (!c) return reply.code(401).send({ error: "grant" });
    return store.write(c.orgId, (s) =>
      ops.retire(s, c, String(b.ref ?? ""), num(b.expectedVersion)),
    );
  });
  app.post("/v1/admin/attach", async (req, reply) => {
    const b = body(req);
    const c = callerOf(b);
    if (!c) return reply.code(401).send({ error: "grant" });
    const ref =
      b.policyRef === null ? null : typeof b.policyRef === "string" ? b.policyRef : undefined;
    if (ref === undefined)
      return { ok: false, reason: "invalid", detail: "policyRef", path: "policyRef" };
    return store.write(c.orgId, (s) => ops.attach(s, c, String(b.principalId ?? ""), ref));
  });

  app.get("/v1/orgs/:orgId", async (req, reply) => {
    const o = ORGS.find((x) => x.id === (req.params as { orgId: string }).orgId);
    return o
      ? { id: o.id, name: o.name, centers: o.centers }
      : reply.code(404).send({ error: "not_found" });
  });

  return { app, state };
}
