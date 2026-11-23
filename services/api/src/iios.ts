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

export interface IiosClient {
  resolve(grant: string, intendedOrgId: string): Promise<ResolveOutcome>;
}

export function httpIiosClient(opts: {
  baseUrl: string;
  clientSecret: string;
  timeoutMs?: number;
}): IiosClient {
  return {
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
