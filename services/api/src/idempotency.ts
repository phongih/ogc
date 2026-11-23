/*
 * Idempotency (ADR-039 F6, ADR-040 §4). Every write carries an `Idempotency-Key`:
 *   - same key + same route + same body → the stored result, the write does not run again;
 *   - same key + a different body or route → refused (409);
 * The key row is inserted in the SAME transaction as the write, so either both commit or neither.
 * Two concurrent requests with one key: the second waits on the primary key and then reads the
 * first one's stored result.
 */
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { stableJson } from "./audit.js";
import type { TenantTx } from "./db.js";

export const KEY_FORMAT = /^[A-Za-z0-9_\-:.]{8,128}$/;

export type IdempotentOutcome<T> =
  | { kind: "fresh"; status: number; body: T }
  | { kind: "replay"; status: number; body: unknown }
  | { kind: "conflict" };

export async function idempotent<T>(
  tx: TenantTx,
  input: { orgId: string; principalId: string; key: string; route: string; body: unknown },
  run: () => Promise<{ status: number; body: T }>,
): Promise<IdempotentOutcome<T>> {
  const requestHash = createHash("sha256")
    .update(`${input.route}\n${stableJson(input.body)}`)
    .digest("hex");
  // Claim the key first: a concurrent holder makes us wait, then we see its row.
  const claimed = await sql<{ key: string }>`
    insert into idempotency_key (org_id, key, principal_id, route, request_hash, status_code, response)
    values (${input.orgId}, ${input.key}, ${input.principalId}, ${input.route}, ${requestHash}, 0, 'null'::jsonb)
    on conflict (org_id, key) do nothing
    returning key`.execute(tx);
  if (claimed.rows.length === 0) {
    const prev = await tx
      .selectFrom("idempotency_key")
      .select(["request_hash", "status_code", "response", "principal_id"])
      .where("org_id", "=", input.orgId)
      .where("key", "=", input.key)
      .executeTakeFirstOrThrow();
    if (prev.request_hash !== requestHash || prev.principal_id !== input.principalId)
      return { kind: "conflict" };
    return { kind: "replay", status: prev.status_code, body: prev.response };
  }
  const out = await run();
  await sql`update idempotency_key set status_code = ${out.status}, response = ${JSON.stringify(out.body)}::jsonb
            where org_id = ${input.orgId} and key = ${input.key}`.execute(tx);
  return { kind: "fresh", ...out };
}
