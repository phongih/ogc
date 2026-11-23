/*
 * DAK — tenant-scoped data access (ADR-040 §3.4, §4). Handlers never get a raw database handle:
 * they get a transaction bound to the decided grant's organization. Row-level security on every
 * tenant table checks `app.org_id`, so a query that forgets its filter still sees nothing of
 * another organization, and a write for another organization is refused by the database.
 */
import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";

export interface AuditEventTable {
  event_id: string;
  org_id: string;
  principal_id: string;
  request_id: string;
  iios_request_id: string | null;
  action: string;
  resource: unknown;
  outcome: "allowed" | "denied" | "failed";
  reason: string | null;
  at: Date;
  before_hash: string | null;
  after_hash: string | null;
}

export interface IdempotencyKeyTable {
  org_id: string;
  key: string;
  principal_id: string;
  route: string;
  request_hash: string;
  status_code: number;
  response: unknown;
  created_at: Date;
}

// Kysely table typing: columns with database defaults are optional on insert.
type Generated<T> = import("kysely").Generated<T>;
export interface DB {
  audit_event: Omit<AuditEventTable, "event_id" | "at"> & {
    event_id: Generated<string>;
    at: Generated<Date>;
  };
  idempotency_key: Omit<IdempotencyKeyTable, "created_at"> & { created_at: Generated<Date> };
}

export type Db = Kysely<DB>;
export type TenantTx = Transaction<DB>;

export function connect(url: string, max = 10): Db {
  return new Kysely<DB>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max }) }),
  });
}

export interface TenantScope {
  orgId: string;
  principalId: string;
  requestId: string;
}

/** Run `fn` in one transaction scoped to `scope.orgId` (RLS). Nothing commits if it throws. */
export async function withTenant<T>(
  db: Db,
  scope: TenantScope,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(scope.orgId)) throw new Error("dak: organization id is not a uuid");
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('app.org_id', ${scope.orgId}, true),
                     set_config('app.principal_id', ${scope.principalId}, true),
                     set_config('app.request_id', ${scope.requestId}, true)`.execute(tx);
    return fn(tx);
  });
}
