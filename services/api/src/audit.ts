/*
 * Audit (ADR-039 F5, ADR-040 §4): one append-only row per decision that touches tenant data —
 * allowed writes, denied attempts, failed writes. Written through the DAK, so it lands in the
 * caller's organization only. Hashes of before / after, never the data itself.
 */
import { createHash } from "node:crypto";
import type { IiosGrantedContext } from "@ogc/contracts";
import type { TenantTx } from "./db.js";

export const hashOf = (v: unknown): string | null =>
  v === undefined ? null : createHash("sha256").update(stableJson(v)).digest("hex");

/** JSON with object keys sorted, so equal values hash equally. */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(",")}}`;
}

export interface AuditEntry {
  action: string;
  resource: Record<string, unknown>;
  outcome: "allowed" | "denied" | "failed";
  reason?: string;
  before?: unknown;
  after?: unknown;
}

export async function audit(
  tx: TenantTx,
  ctx: IiosGrantedContext,
  requestId: string,
  e: AuditEntry,
): Promise<void> {
  await tx
    .insertInto("audit_event")
    .values({
      org_id: ctx.orgId,
      principal_id: ctx.principalId,
      request_id: requestId,
      iios_request_id: ctx.requestId,
      action: e.action,
      resource: JSON.stringify(e.resource),
      outcome: e.outcome,
      reason: e.reason ?? null,
      before_hash: hashOf(e.before),
      after_hash: hashOf(e.after),
    })
    .execute();
}
