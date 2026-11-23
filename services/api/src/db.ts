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
export interface CenterTable {
  org_id: string;
  id: string;
  name: string;
}
export interface TeacherTable {
  org_id: string;
  id: string;
  principal_id: string | null;
  name: string;
}
export interface LearnerTable {
  org_id: string;
  id: string;
  principal_id: string | null;
  display_name: string;
}
export interface ClassTable {
  org_id: string;
  id: string;
  center_id: string;
  name: string;
  teacher_id: string | null;
  room: string | null;
  duration_min: Generated<number>;
  course_id: string | null;
}
export interface RosterTable {
  org_id: string;
  class_id: string;
  learner_id: string;
}
export interface SessionTable {
  org_id: string;
  id: string;
  class_id: string;
  title: string;
  at: Date;
  state: Generated<"scheduled" | "cancelled">;
  kind: Generated<"regular" | "makeup">;
  substitute_id: string | null;
  held_by: string | null;
  replaced_by: string | null;
  replaces: string | null;
}
export interface AttendanceTable {
  org_id: string;
  session_id: string;
  learner_id: string;
  mark: "present" | "late" | "absent";
  marked_by: string;
  marked_at: Generated<Date>;
}

export interface GuardianLinkTable {
  org_id: string;
  guardian_principal_id: string;
  learner_id: string;
}
export interface MakeupBookingTable {
  org_id: string;
  missed_session_id: string;
  learner_id: string;
  session_id: string;
  booked_by: string;
  booked_at: Generated<Date>;
}
export interface MakeupSelfStudyTable {
  org_id: string;
  missed_session_id: string;
  learner_id: string;
  assigned_by: string;
  assigned_at: Generated<Date>;
  submitted_at: Date | null;
  note: string | null;
  returned_note: string | null;
  confirmed_at: Date | null;
  confirmed_by: string | null;
}

export interface DB {
  center: CenterTable;
  teacher: TeacherTable;
  learner: LearnerTable;
  class: ClassTable;
  roster: RosterTable;
  session: SessionTable;
  attendance: AttendanceTable;
  guardian_link: GuardianLinkTable;
  makeup_booking: MakeupBookingTable;
  makeup_selfstudy: MakeupSelfStudyTable;
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
