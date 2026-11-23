/*
 * IIOS client (ADR-040 §3.3, IIOS handoff 23/11). The API presents the caller's opaque grant and
 * the organization it intends to act in; IIOS (the mock until real IIOS exists) DECIDES. The API
 * never holds a signing key and never verifies a signature (OGC-DEC-027).
 *
 * Fail-closed: a timeout, a network error, a non-200 answer or an answer that does not match the
 * contract is reported as `unavailable` — the request is refused, never let through.
 */
import { IiosContextResolution, type IiosGrantedContext } from "@ogc/contracts";

export type ResolveOutcome =
  | { kind: "valid"; context: IiosGrantedContext }
  | { kind: "denied"; state: Exclude<IiosContextResolution["state"], "valid"> }
  | { kind: "unavailable"; detail: string };

export interface DevMember {
  principalId: string;
  orgId: string;
  orgName: string;
  displayName: string;
  role: string;
}

/** IIOS's answer to a policy admin call: the decision, IIOS's refusal, or no usable answer. */
export type AdminOutcome<T> =
  | { kind: "ok"; body: T }
  | { kind: "not_admin" }
  | { kind: "denied" } // IIOS would not open the grant (expired / revoked / other org)
  | { kind: "unavailable" };

export interface IiosClient {
  resolve(grant: string, intendedOrgId: string): Promise<ResolveOutcome>;
  /**
   * Access policy administration (OGC-ADR-039 option C): IIOS stores and decides; OGC passes the
   * caller's own grant and relays the result. `path` is the IIOS admin operation.
   */
  policyAdmin?(
    path: "view" | "create" | "revise" | "retire" | "attach",
    grant: string,
    orgId: string,
    body: Record<string, unknown>,
  ): Promise<AdminOutcome<unknown>>;
  /** Staging only (mock IIOS): list synthetic members and issue a grant for one of them. */
  dev?: {
    members(): Promise<DevMember[] | null>;
    issue(principalId: string, orgId: string): Promise<{ grant: string; expiresAt: string } | null>;
  };
}

export function httpIiosClient(opts: {
  baseUrl: string;
  clientSecret: string;
  timeoutMs?: number;
}): IiosClient {
  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    try {
      const res = await fetch(`${opts.baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${opts.clientSecret}`,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
      });
      return res.status === 200 ? ((await res.json()) as unknown) : null;
    } catch {
      return null;
    }
  };
  return {
    async policyAdmin(path, grant, orgId, body) {
      const url = path === "attach" ? "/v1/admin/attach" : `/v1/admin/policies/${path}`;
      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}${url}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opts.clientSecret}`,
          },
          body: JSON.stringify({ ...body, grant, orgId }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
        });
      } catch {
        return { kind: "unavailable" };
      }
      if (res.status === 401) return { kind: "denied" };
      if (res.status === 403) return { kind: "not_admin" };
      if (res.status !== 200) return { kind: "unavailable" };
      const b = (await res.json().catch(() => null)) as unknown;
      return b && typeof b === "object" ? { kind: "ok", body: b } : { kind: "unavailable" };
    },
    dev: {
      async members() {
        const r = await call("GET", "/v1/dev/members");
        return Array.isArray(r) ? (r as DevMember[]) : null;
      },
      async issue(principalId, orgId) {
        const r = (await call("POST", "/v1/dev/grants", { principalId, orgId })) as {
          grant?: unknown;
          expiresAt?: unknown;
        } | null;
        return r && typeof r.grant === "string" && typeof r.expiresAt === "string"
          ? { grant: r.grant, expiresAt: r.expiresAt }
          : null;
      },
    },
    async resolve(grant, intendedOrgId) {
      let res: Response;
      try {
        res = await fetch(`${opts.baseUrl}/v1/grants/resolve`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${opts.clientSecret}`,
          },
          body: JSON.stringify({ grant, intendedOrgId }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 2000),
        });
      } catch (e) {
        return { kind: "unavailable", detail: (e as Error).name };
      }
      if (res.status !== 200) return { kind: "unavailable", detail: `status ${res.status}` };
      const parsed = IiosContextResolution.safeParse(await res.json().catch(() => null));
      if (!parsed.success) return { kind: "unavailable", detail: "malformed answer" };
      const r = parsed.data;
      if (r.state === "valid") {
        // A "valid" answer must carry a context for the organization we asked about.
        if (!r.context || r.context.orgId !== intendedOrgId)
          return { kind: "unavailable", detail: "valid without a matching context" };
        return { kind: "valid", context: r.context };
      }
      return { kind: "denied", state: r.state };
    },
  };
}
