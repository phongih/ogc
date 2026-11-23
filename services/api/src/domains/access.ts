/*
 * Access policies on the Platform API (OGC-ADR-039 option C, owner decision 23/11): IIOS STORES and
 * DECIDES; this API is the path the Access page takes. Every call presents the caller's OWN grant to
 * IIOS, which re-checks that the caller administers the organization (from IIOS's member data) and
 * applies the demo's rules (closed catalog, versions, no self-change, fail-closed). OGC keeps no
 * copy of a policy and writes no authorization relation; it adds what OGC owns: the request id,
 * idempotency for writes, and one audit row per decision in the organization's audit log.
 *
 * Results come back as the contract's `PolicyResult` (`ok` true / false) with an HTTP status:
 * 200 ok · 403 not_admin · 404 not_found · 422 invalid · 409 the other refusals.
 */
import type { AccessAdminView, PolicyRefusal, PolicyResult } from "@ogc/contracts";
import { z } from "zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { audit } from "../audit.js";
import type { AdminOutcome, IiosClient } from "../iios.js";
import type { Api, Caller } from "../server.js";

const STATUS: Record<PolicyRefusal, number> = {
  not_admin: 403,
  not_found: 404,
  invalid: 422,
  name_taken: 409,
  stale: 409,
  retired: 409,
  in_use: 409,
  self: 409,
  not_applicable: 409,
};

// Shapes only; IIOS validates the content (closed catalog) and answers with a path.
const CreateBody = z.object({
  name: z.string().max(200),
  description: z.string().max(1000).nullable().optional(),
  rules: z.array(z.unknown()).max(50),
});
const ReviseBody = z.object({
  expectedVersion: z.number().int().min(1),
  description: z.string().max(1000).nullable().optional(),
  rules: z.array(z.unknown()).max(50).optional(),
});
const RetireBody = z.object({ expectedVersion: z.number().int().min(1) });
const AttachBody = z.object({ policyRef: z.string().min(1).max(100).nullable() });
const REF = /^[A-Za-z0-9_.:-]{1,100}$/;

class IiosUnavailable extends Error {}

const grantOf = (req: FastifyRequest) => (req.headers.authorization ?? "").slice(7).trim();

function isResult(b: unknown): b is PolicyResult {
  if (!b || typeof b !== "object" || !("ok" in b)) return false;
  const r = b as { ok: unknown; reason?: unknown; view?: unknown };
  return r.ok === true ? !!r.view && typeof r.view === "object" : typeof r.reason === "string";
}

export function registerAccess(app: Api, iios: IiosClient): void {
  const admin = iios.policyAdmin?.bind(iios);

  async function ask(
    caller: Caller,
    req: FastifyRequest,
    path: Parameters<NonNullable<IiosClient["policyAdmin"]>>[0],
    body: Record<string, unknown>,
  ): Promise<AdminOutcome<unknown>> {
    if (!admin) return { kind: "unavailable" };
    return admin(path, grantOf(req), caller.ctx.orgId, body);
  }

  /** Refuse early (and audit) when the grant does not even claim org admin; IIOS re-decides. */
  async function needAdmin(caller: Caller, reply: FastifyReply, resource: Record<string, unknown>) {
    if (caller.ctx.orgAdmin) return true;
    await caller.tenant((tx) =>
      audit(tx, caller.ctx, caller.requestId, {
        action: "access:policy",
        resource,
        outcome: "denied",
        reason: "not_admin",
      }),
    );
    await reply.code(403).send({ ok: false, reason: "not_admin" });
    return false;
  }

  app.secured("GET", "/v1/access/admin", async (caller, req, reply) => {
    if (!(await needAdmin(caller, reply, { view: true }))) return;
    const r = await ask(caller, req, "view", {});
    if (r.kind === "ok") return r.body as AccessAdminView;
    if (r.kind === "not_admin") return reply.code(403).send({ ok: false, reason: "not_admin" });
    if (r.kind === "denied") return reply.code(401).send({ error: "iios_denied" });
    return reply.code(503).send({ error: "iios_unavailable" });
  });

  /** A write: idempotency + audit in OGC's transaction around IIOS's decision. */
  function write(
    method: "POST" | "PUT",
    url: string,
    schema: z.ZodTypeAny,
    build: (
      req: FastifyRequest,
      body: Record<string, unknown>,
    ) => {
      path: "create" | "revise" | "retire" | "attach";
      payload: Record<string, unknown>;
      resource: Record<string, unknown>;
    } | null,
  ) {
    app.secured(method, url, async (caller, req, reply) => {
      const parsed = schema.safeParse(req.body ?? {});
      const built = parsed.success ? build(req, parsed.data) : null;
      if (!built)
        return reply.code(400).send({ ok: false, reason: "invalid", detail: "bad request" });
      if (!(await needAdmin(caller, reply, built.resource))) return;
      try {
        await caller.write(
          `${method} ${url}`,
          { params: req.params, body: parsed.data },
          async () => {
            const r = await ask(caller, req, built.path, built.payload);
            if (
              r.kind === "unavailable" ||
              r.kind === "denied" ||
              (r.kind === "ok" && !isResult(r.body))
            )
              throw new IiosUnavailable();
            const result: PolicyResult =
              r.kind === "not_admin"
                ? { ok: false, reason: "not_admin" }
                : (r.body as PolicyResult);
            return {
              status: result.ok ? 200 : (STATUS[result.reason] ?? 409),
              body: result,
              audit: {
                action: `access:policy.${built.path}`,
                resource: built.resource,
                outcome: result.ok ? "allowed" : "denied",
                ...(result.ok ? {} : { reason: result.reason }),
                after: result.ok ? built.payload : undefined,
              },
            };
          },
        );
      } catch (e) {
        if (e instanceof IiosUnavailable)
          return reply.code(503).send({ error: "iios_unavailable" });
        throw e;
      }
    });
  }

  write("POST", "/v1/access/policies", CreateBody, (_req, b) => ({
    path: "create",
    payload: { input: { name: b.name, description: b.description ?? null, rules: b.rules } },
    resource: { policy: "new", name: b.name },
  }));

  write("PUT", "/v1/access/policies/:ref", ReviseBody, (req, b) => {
    const ref = (req.params as { ref: string }).ref;
    if (!REF.test(ref)) return null;
    const patch: Record<string, unknown> = {};
    if (b.description !== undefined) patch.description = b.description;
    if (b.rules !== undefined) patch.rules = b.rules;
    return {
      path: "revise",
      payload: { ref, expectedVersion: b.expectedVersion, patch },
      resource: { policy: ref, expectedVersion: b.expectedVersion },
    };
  });

  write("POST", "/v1/access/policies/:ref/retire", RetireBody, (req, b) => {
    const ref = (req.params as { ref: string }).ref;
    if (!REF.test(ref)) return null;
    return {
      path: "retire",
      payload: { ref, expectedVersion: b.expectedVersion },
      resource: { policy: ref, expectedVersion: b.expectedVersion },
    };
  });

  write("PUT", "/v1/access/members/:principalId/policy", AttachBody, (req, b) => {
    const principalId = (req.params as { principalId: string }).principalId;
    if (!REF.test(principalId)) return null;
    return {
      path: "attach",
      payload: { principalId, policyRef: b.policyRef },
      resource: { member: principalId, policy: b.policyRef },
    };
  });
}
