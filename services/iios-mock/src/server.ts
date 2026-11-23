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
import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import {
  IiosGrantedContext,
  type GrantNarrowing,
  type IiosContextResolution,
} from "@ogc/contracts";
import { MEMBERS, ORGS, seedPolicies, type Member, type StoredPolicy } from "./seed.js";
import { open, sign } from "./token.js";

export interface IiosMockOptions {
  key: Buffer; // dev signing key, ≥ 32 bytes
  clientId: string; // the one client allowed (OGC)
  clientSecret: string;
  now?: () => number; // ms, for tests
}

export interface IiosMockState {
  policies: Map<string, StoredPolicy>;
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
  const app = Fastify({ logger: false, bodyLimit: 16 * 1024 });
  const secret = Buffer.from(opts.clientSecret);

  app.addHook("onRequest", async (req, reply) => {
    const h = req.headers.authorization ?? "";
    const got = Buffer.from(h.startsWith("Bearer ") ? h.slice(7) : "");
    if (got.length !== secret.length || !timingSafeEqual(got, secret))
      return reply.code(401).send({ error: "client_unauthorized" });
  });

  const memberOf = (principalId: string, orgId: string): Member | undefined =>
    MEMBERS.find((m) => m.principalId === principalId && m.orgId === orgId);

  function narrowingFor(m: Member): GrantNarrowing {
    if (m.role === "admin") return { state: "none" }; // an Org Admin is never narrowed
    const ref = state.attachments.get(m.principalId);
    if (!ref) return { state: "none" };
    const p = state.policies.get(ref);
    if (!p || p.status !== "active" || p.orgId !== m.orgId || p.rules.length === 0)
      return { state: "unavailable" }; // fail-closed: attached but unresolvable
    return { state: "policy", policyRef: p.ref, version: p.version, name: p.name, rules: p.rules };
  }

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
      narrowing: narrowingFor(m),
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

  app.get("/v1/orgs/:orgId", async (req, reply) => {
    const o = ORGS.find((x) => x.id === (req.params as { orgId: string }).orgId);
    return o
      ? { id: o.id, name: o.name, centers: o.centers }
      : reply.code(404).send({ error: "not_found" });
  });

  return { app, state };
}
