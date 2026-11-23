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
  pays_own_tuition: Generated<boolean>;
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
  guardian_name: string | null;
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

export interface TeacherTargetTable {
  org_id: string;
  teacher_id: string;
  employment: "full_time" | "part_time";
  target_hours: string | number; // numeric: pg returns a string
  updated_by: string;
  updated_at: Generated<Date>;
}
export interface WorkforceSettingsTable {
  org_id: string;
  under_pct: number;
  over_pct: number;
  updated_by: string;
  updated_at: Generated<Date>;
}

export interface CourseTable {
  org_id: string;
  id: string;
  code: string;
  name: string;
}
export interface StaffMemberTable {
  org_id: string;
  principal_id: string;
  display_name: string;
  role: "staff" | "admin";
}
export interface LeadTable {
  org_id: string;
  id: string;
  learner_name: string;
  course_code: string;
  center_id: string;
  source: "referral" | "walk_in" | "website" | "event" | "phone";
  referrer_name: string | null;
  campaign_id: string | null;
  channel: "zalo" | "phone" | "email" | "in_person" | null;
  needs: Generated<string[]>;
  note: Generated<string>;
  stage: "new" | "assigned" | "contacted" | "placement" | "offer" | "enrolled" | "lost";
  assigned_to: string | null;
  invoice_no: string | null;
  first_payment_vnd: string | number | null; // bigint: pg returns a string
  lost_reason: string | null;
  created_at: Date;
}
export interface LeadHistoryTable {
  org_id: string;
  lead_id: string;
  seq: number;
  stage: LeadTable["stage"];
  at: Date;
  by_name: string;
}
export interface LeadActivityTable {
  org_id: string;
  lead_id: string;
  seq: number;
  kind: "call" | "message" | "meeting" | "note";
  text: string;
  at: Date;
  by_name: string;
}
export interface AdmissionsSettingsTable {
  org_id: string;
  max: unknown;
  hot_at: number;
  warm_at: number;
  stale_days: number;
  updated_by: string;
  updated_at: Generated<Date>;
}

// Dates (`date` columns) are read as text (`::text`) — node-pg would turn them into local Dates.
export interface FeeLineTable {
  org_id: string;
  id: string;
  year: string;
  course_code: string;
  center_id: string | null;
  kind: "tuition" | "materials";
  period: string;
  from_date: string;
  to_date: string;
  due_date: string;
  amount_vnd: string | number; // bigint: pg returns a string
  status: "pending" | "approved" | "rejected" | "retired";
  proposed_by: string;
  proposed_by_name: string;
  proposed_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
  note: string | null;
}
export interface InvoiceTable {
  org_id: string;
  id: string;
  no: string;
  center_id: string;
  learner_name: string;
  learner_id: string | null;
  lead_id: string | null;
  payer_principal_id: string | null;
  payer_name: string | null;
  subtotal_vnd: string | number;
  credit_applied_vnd: Generated<string | number>;
  issued_at: Date;
  due_date: string;
  void_reason: string | null;
  voided_at: Date | null;
}
export interface InvoiceLineTable {
  org_id: string;
  invoice_id: string;
  fee_line_id: string;
  description: string;
  amount_vnd: string | number;
}
export interface PaymentTable {
  org_id: string;
  id: string;
  invoice_id: string;
  amount_vnd: string | number;
  method: "cash" | "bank_transfer" | "card";
  receipt_no: string;
  at: Date;
  recorded_by: string;
}

export interface PartnerTable {
  org_id: string;
  id: string;
  name: string;
  courses: string[];
  near_center_ids: string[];
  retention_pct: number;
  settlement_days: number;
}
export interface PartnerRuleTable {
  org_id: string;
  id: string;
  partner_id: string;
  version: number;
  status: "pending" | "active" | "retired" | "rejected";
  cycle: "monthly" | "quarterly";
  mode: "progressive" | "retroactive";
  tiers: unknown; // jsonb: { minCount, amountVnd }[]
  attribution_window_days: number;
  clawback_window_days: number;
  proposed_by: string;
  proposed_by_name: string;
  proposed_at: Date;
  decided_by_name: string | null;
  decided_at: Date | null;
}
export interface CommissionEntryTable {
  org_id: string;
  id: string;
  partner_id: string;
  lead_id: string | null;
  lead_ref_code: string;
  learner_display_name: string;
  course_code: string;
  referred_at: Date;
  expires_at: Date;
  enrolled_at: Date | null;
  enrolled_by: string | null;
  status: "referred" | "enrolled" | "approved" | "paid" | "rejected";
  applied_rule_id: string | null;
  locked_amount_vnd: string | number | null;
  locked_tier_index: number | null;
  approved_at: Date | null;
  due_date: Date | null;
  reject_reason: string | null;
  settled_batch_id: string | null;
  updated_by_name: string;
  updated_at: Date;
}
export interface PartnerActivityTable {
  org_id: string;
  seq: number;
  at: Date;
  by_name: string;
  action: string;
  subject: string;
  detail: string | null;
}
export interface PartnerSignalMarkTable {
  org_id: string;
  signal_id: string;
  state: "snoozed" | "dismissed" | "followed";
  note: string | null;
  until: Date | null;
  by_name: string;
  at: Date;
}

export interface AuthoredCourseTable {
  org_id: string;
  ref: string;
  owner_teacher_id: string | null;
  owner_principal_id: string;
  owner_name: string;
  draft: unknown; // jsonb: CourseContent
  revision: number;
  editors: unknown; // jsonb: { id, name }[]
  pending_content: unknown | null;
  pending_by: string | null;
  pending_by_name: string | null;
  pending_at: Date | null;
  updated_at: Date;
}
export interface CourseVersionTable {
  org_id: string;
  course_ref: string;
  version: number;
  content: unknown; // jsonb: CourseContent, immutable
  submitted_by: string;
  approved_by: string;
  published_at: Date;
  note: string | null;
}
export interface CourseReviewTable {
  org_id: string;
  course_ref: string;
  seq: number;
  at: Date;
  by_name: string;
  action: "submitted" | "withdrawn" | "approved" | "returned";
  version: number | null;
  note: string | null;
}

export interface SettlementBatchTable {
  org_id: string;
  id: string;
  partner_id: string;
  cycle_key: string;
  cycle_label: string;
  status: "draft" | "sent" | "paid" | "cancelled";
  created_by: string;
  created_by_name: string;
  created_at: Date;
  sent_by_name: string | null;
  sent_at: Date | null;
  due_date: Date | null;
  paid_by_name: string | null;
  paid_at: Date | null;
  payment_ref: string | null;
  cancel_reason: string | null;
}
export interface SettlementBatchEntryTable {
  org_id: string;
  batch_id: string;
  entry_id: string;
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
  teacher_target: TeacherTargetTable;
  workforce_settings: WorkforceSettingsTable;
  course: CourseTable;
  staff_member: StaffMemberTable;
  lead: LeadTable;
  lead_history: LeadHistoryTable;
  lead_activity: LeadActivityTable;
  admissions_settings: AdmissionsSettingsTable;
  fee_line: FeeLineTable;
  invoice: InvoiceTable;
  invoice_line: InvoiceLineTable;
  payment: PaymentTable;
  partner: PartnerTable;
  partner_rule: PartnerRuleTable;
  commission_entry: CommissionEntryTable;
  partner_activity: PartnerActivityTable;
  partner_signal_mark: PartnerSignalMarkTable;
  settlement_batch: SettlementBatchTable;
  settlement_batch_entry: SettlementBatchEntryTable;
  authored_course: AuthoredCourseTable;
  course_version: CourseVersionTable;
  course_review: CourseReviewTable;
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
