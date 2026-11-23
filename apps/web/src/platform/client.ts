/*
 * Platform API client (ADR-040 §5: the `http` side; no mock, no fixture). Same origin: nginx
 * proxies `/v1/…` on app.ogc.eduos.vn to the API. Every call carries the grant and the
 * organization; every write carries a fresh Idempotency-Key. Domain refusals come back in the
 * contract's result shapes (ScheduleResult, RecordAttendanceResult) whatever the HTTP status.
 */
import type {
  LearnerStudioProgress,
  MyClassCourse,
  MyLessonView,
  StudioCourse,
  StudioOverview,
  StudioResult,
  AuthoredCourseDetail,
  AuthoredCourseSummary,
  AuthoringResult,
  CourseContent,
  AccessAdminView,
  ActivityEntry,
  BatchCandidate,
  CommissionEntry,
  Partner,
  PartnerFit,
  PartnersOverview,
  PartnersResult,
  PartnerTrend,
  ReportRow,
  SettlementBatch,
  TierRuleDraft,
  BillingResult,
  FeeLine,
  FeeLineDraft,
  Invoice,
  MyBilling,
  Payment,
  PaymentMethod,
  Receivables,
  AdmissionsDashboard,
  AdmissionsResult,
  Lead,
  LeadActivityKind,
  LeadDraft,
  LeadStage,
  ScoringSettings,
  Employment,
  LoadCandidate,
  WorkforceOverview,
  WorkforceResult,
  WorkforceSettings,
  MakeupBoard,
  MakeupItem,
  MakeupItemResult,
  MakeupOption,
  MakeupResult,
  AttendanceMark,
  PolicyInput,
  PolicyResult,
  PolicyRule,
  AttendanceSummaryRow,
  ClassSession,
  OperationsOverview,
  RecordAttendanceResult,
  ScheduleResult,
  SessionAttendance,
} from "@ogc/contracts";
import type { PlatformSession } from "./session";

const BASE = (import.meta.env.VITE_OGC_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`api ${status}`);
  }
}

export interface Persona {
  principalId: string;
  orgId: string;
  orgName: string;
  displayName: string;
  role: string;
}

export interface MyClass {
  classId: string;
  className: string;
  centerName: string;
  learnerCount: number;
}

export interface MyAccess {
  role: string;
  orgAdmin: boolean;
  narrowing: { state: string; name?: string };
  allowed: string[];
}

async function send(
  s: PlatformSession | null,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (s) {
    headers.authorization = `Bearer ${s.grant}`;
    headers["x-ogc-org"] = s.orgId;
  }
  if (method !== "GET") headers["idempotency-key"] = crypto.randomUUID();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

/** A read: anything but 200 is an error (401 sends the user back to sign in). */
async function read<T>(s: PlatformSession, path: string): Promise<T> {
  const r = await send(s, "GET", path);
  if (r.status !== 200) throw new ApiError(r.status, r.body);
  return r.body as T;
}

/** A write whose body is a contract result (`ok` true or false) for any 2xx–4xx answer. */
async function result<T extends { ok: boolean }>(
  s: PlatformSession,
  method: "POST" | "PUT",
  path: string,
  body: unknown,
): Promise<T> {
  const r = await send(s, method, path, body);
  const b = r.body as T | null;
  if (b && typeof b === "object" && "ok" in b) return b;
  throw new ApiError(r.status, r.body);
}

/** A staff-only read: 403 (not staff) is "nothing to show", not an error. */
async function staffRead<T>(s: PlatformSession, path: string): Promise<T | null> {
  const r = await send(s, "GET", path);
  if (r.status === 403) return null;
  if (r.status !== 200) throw new ApiError(r.status, r.body);
  return r.body as T;
}

export const platformApi = {
  personas: async (): Promise<Persona[]> => {
    const r = await send(null, "GET", "/v1/dev/personas");
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as Persona[];
  },
  login: async (principalId: string, orgId: string) => {
    const r = await send(null, "POST", "/v1/dev/login", { principalId, orgId });
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as { grant: string; expiresAt: string; orgId: string };
  },
  myAccess: (s: PlatformSession) => read<MyAccess>(s, "/v1/me/access"),

  // Schedule (staff)
  schedule: (s: PlatformSession) => read<OperationsOverview>(s, "/v1/schedule"),
  reschedule: (s: PlatformSession, sessionId: string, at: string) =>
    result<ScheduleResult>(s, "POST", `/v1/sessions/${encodeURIComponent(sessionId)}/reschedule`, {
      at,
    }),
  cancel: (s: PlatformSession, sessionId: string, replacementAt: string) =>
    result<ScheduleResult>(s, "POST", `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      replacementAt,
    }),
  addSession: (s: PlatformSession, classId: string, title: string, at: string) =>
    result<ScheduleResult>(s, "POST", `/v1/classes/${encodeURIComponent(classId)}/sessions`, {
      title,
      at,
    }),
  assignTeacher: (s: PlatformSession, classId: string, teacherId: string) =>
    result<ScheduleResult>(s, "PUT", `/v1/classes/${encodeURIComponent(classId)}/teacher`, {
      teacherId,
    }),
  setSubstitute: (s: PlatformSession, sessionId: string, teacherId: string | null) =>
    result<ScheduleResult>(s, "PUT", `/v1/sessions/${encodeURIComponent(sessionId)}/substitute`, {
      teacherId,
    }),

  // Access policies (Org Admin; IIOS stores and decides, the API relays — OGC-ADR-039 option C)
  accessAdmin: async (s: PlatformSession): Promise<AccessAdminView | null> => {
    const r = await send(s, "GET", "/v1/access/admin");
    if (r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as AccessAdminView;
  },
  createPolicy: (s: PlatformSession, input: PolicyInput) =>
    result<PolicyResult>(s, "POST", "/v1/access/policies", input),
  revisePolicy: (
    s: PlatformSession,
    ref: string,
    expectedVersion: number,
    patch: { description?: string | null; rules?: PolicyRule[] },
  ) =>
    result<PolicyResult>(s, "PUT", `/v1/access/policies/${encodeURIComponent(ref)}`, {
      expectedVersion,
      ...patch,
    }),
  retirePolicy: (s: PlatformSession, ref: string, expectedVersion: number) =>
    result<PolicyResult>(s, "POST", `/v1/access/policies/${encodeURIComponent(ref)}/retire`, {
      expectedVersion,
    }),
  attachPolicy: (s: PlatformSession, member: string, ref: string | null) =>
    result<PolicyResult>(s, "PUT", `/v1/access/members/${encodeURIComponent(member)}/policy`, {
      policyRef: ref,
    }),

  // Make-ups (staff arrange; learners submit self-study; guardians read; class teachers confirm)
  makeupBoard: async (s: PlatformSession): Promise<MakeupBoard | null> => {
    const r = await send(s, "GET", "/v1/makeups");
    if (r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as MakeupBoard;
  },
  makeupOptions: async (s: PlatformSession, item: string): Promise<MakeupOption[] | null> => {
    const r = await send(s, "GET", `/v1/makeups/${encodeURIComponent(item)}/options`);
    if (r.status === 404 || r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as MakeupOption[];
  },
  bookMakeup: (s: PlatformSession, item: string, sessionId: string) =>
    result<MakeupResult>(s, "POST", `/v1/makeups/${encodeURIComponent(item)}/book`, { sessionId }),
  openMakeupSession: (s: PlatformSession, item: string, at: string, teacherId: string) =>
    result<MakeupResult>(s, "POST", `/v1/makeups/${encodeURIComponent(item)}/makeup-session`, {
      at,
      teacherId,
    }),
  assignSelfStudy: (s: PlatformSession, item: string) =>
    result<MakeupResult>(s, "POST", `/v1/makeups/${encodeURIComponent(item)}/self-study`, {}),
  myMakeups: (s: PlatformSession) => read<MakeupItem[]>(s, "/v1/me/makeups"),
  submitSelfStudy: (s: PlatformSession, item: string, note: string) =>
    result<MakeupItemResult>(s, "POST", `/v1/me/makeups/${encodeURIComponent(item)}/self-study`, {
      note,
    }),
  selfStudyToConfirm: (s: PlatformSession) => read<MakeupItem[]>(s, "/v1/me/makeups/to-confirm"),
  confirmSelfStudy: (s: PlatformSession, item: string) =>
    result<MakeupItemResult>(s, "POST", `/v1/makeups/${encodeURIComponent(item)}/confirm`, {}),
  returnSelfStudy: (s: PlatformSession, item: string, note: string) =>
    result<MakeupItemResult>(s, "POST", `/v1/makeups/${encodeURIComponent(item)}/return`, { note }),

  // Workforce (staff; workforce:manage for targets and thresholds) — suggestions never assign
  workforce: async (s: PlatformSession): Promise<WorkforceOverview | null> => {
    const r = await send(s, "GET", "/v1/workforce");
    if (r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as WorkforceOverview;
  },
  setTarget: (s: PlatformSession, teacherId: string, employment: Employment, targetHours: number) =>
    result<WorkforceResult>(
      s,
      "PUT",
      `/v1/workforce/teachers/${encodeURIComponent(teacherId)}/target`,
      {
        employment,
        targetHours,
      },
    ),
  updateWorkforceSettings: (s: PlatformSession, next: WorkforceSettings) =>
    result<WorkforceResult>(s, "PUT", "/v1/workforce/settings", next),
  suggestForClass: (s: PlatformSession, classId: string) =>
    read<LoadCandidate[]>(s, `/v1/workforce/suggest/class/${encodeURIComponent(classId)}`),
  suggestForSession: (s: PlatformSession, sessionId: string) =>
    read<LoadCandidate[]>(s, `/v1/workforce/suggest/session/${encodeURIComponent(sessionId)}`),

  // Admissions (staff; admissions:manage by center) — offer/enrolled follow Billing only
  admissionsDashboard: (s: PlatformSession) =>
    staffRead<AdmissionsDashboard>(s, "/v1/admissions/dashboard"),
  admissionsOptions: (s: PlatformSession) =>
    staffRead<{ centers: { id: string; name: string }[]; courseCodes: string[] }>(
      s,
      "/v1/admissions/options",
    ),
  leads: (s: PlatformSession) => staffRead<Lead[]>(s, "/v1/admissions/leads"),
  counselors: (s: PlatformSession) =>
    staffRead<{ principalId: string; name: string }[]>(s, "/v1/admissions/counselors"),
  admissionsSettings: (s: PlatformSession) =>
    staffRead<ScoringSettings>(s, "/v1/admissions/settings"),
  createLead: (s: PlatformSession, d: LeadDraft) =>
    result<AdmissionsResult>(s, "POST", "/v1/admissions/leads", d),
  assignLead: (s: PlatformSession, id: string, principalId: string) =>
    result<AdmissionsResult>(s, "PUT", `/v1/admissions/leads/${encodeURIComponent(id)}/assign`, {
      principalId,
    }),
  moveLead: (s: PlatformSession, id: string, stage: LeadStage, reason?: string) =>
    result<AdmissionsResult>(s, "PUT", `/v1/admissions/leads/${encodeURIComponent(id)}/stage`, {
      stage,
      ...(reason ? { reason } : {}),
    }),
  logLeadActivity: (s: PlatformSession, id: string, kind: LeadActivityKind, text: string) =>
    result<AdmissionsResult>(
      s,
      "POST",
      `/v1/admissions/leads/${encodeURIComponent(id)}/activities`,
      { kind, text },
    ),
  updateAdmissionsSettings: (s: PlatformSession, next: ScoringSettings) =>
    result<AdmissionsResult>(s, "PUT", "/v1/admissions/settings", next),

  // Partner Commissions (staff with partners:manage; an Org Admin activates rules and approves)
  partnersOverview: (s: PlatformSession) => staffRead<PartnersOverview>(s, "/v1/partners/overview"),
  partners: (s: PlatformSession) => staffRead<Partner[]>(s, "/v1/partners"),
  partnerEntries: (s: PlatformSession) => staffRead<CommissionEntry[]>(s, "/v1/partners/entries"),
  partnerActivity: (s: PlatformSession) => staffRead<ActivityEntry[]>(s, "/v1/partners/activity"),
  suggestPartners: (s: PlatformSession, leadId: string) =>
    staffRead<PartnerFit[]>(s, `/v1/partners/suggest/${encodeURIComponent(leadId)}`),
  referLead: (s: PlatformSession, leadId: string, partnerId: string) =>
    result<PartnersResult>(s, "POST", "/v1/partners/refer", { leadId, partnerId }),
  partnerEntryStep: (
    s: PlatformSession,
    id: string,
    step: "enrolled" | "reject" | "approve",
    body: object = {},
  ) =>
    result<PartnersResult>(
      s,
      "POST",
      `/v1/partners/entries/${encodeURIComponent(id)}/${step}`,
      body,
    ),
  proposePartnerRule: (s: PlatformSession, partnerId: string, d: TierRuleDraft) =>
    result<PartnersResult>(s, "POST", `/v1/partners/${encodeURIComponent(partnerId)}/rules`, d),
  decidePartnerRule: (s: PlatformSession, ruleId: string, decision: "activate" | "reject") =>
    result<PartnersResult>(
      s,
      "POST",
      `/v1/partners/rules/${encodeURIComponent(ruleId)}/${decision}`,
      {},
    ),
  actOnPartnerSignal: (
    s: PlatformSession,
    signalId: string,
    action: "follow" | "snooze" | "dismiss",
    note?: string,
  ) =>
    result<PartnersResult>(s, "POST", "/v1/partners/signals/act", {
      signalId,
      action,
      ...(note ? { note } : {}),
    }),

  partnerBatches: (s: PlatformSession) => staffRead<SettlementBatch[]>(s, "/v1/partners/batches"),
  partnerBatchCandidates: (s: PlatformSession) =>
    staffRead<BatchCandidate[]>(s, "/v1/partners/batch-candidates"),
  draftPartnerBatch: (s: PlatformSession, partnerId: string, cycleLabel: string) =>
    result<PartnersResult>(s, "POST", "/v1/partners/batches", { partnerId, cycleLabel }),
  partnerBatchStep: (
    s: PlatformSession,
    id: string,
    step: "send" | "paid" | "cancel",
    body: object = {},
  ) =>
    result<PartnersResult>(
      s,
      "POST",
      `/v1/partners/batches/${encodeURIComponent(id)}/${step}`,
      body,
    ),
  previewPartnerReport: async (s: PlatformSession, partnerId: string, csv: string) => {
    const r = await send(
      s,
      "POST",
      `/v1/partners/${encodeURIComponent(partnerId)}/report/preview`,
      { csv },
    );
    if (r.status === 403 || r.status === 404 || r.status === 422) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as ReportRow[];
  },
  applyPartnerReportRow: (
    s: PlatformSession,
    partnerId: string,
    row: Pick<ReportRow, "leadRefCode" | "reported" | "date" | "reason">,
  ) =>
    result<PartnersResult>(
      s,
      "POST",
      `/v1/partners/${encodeURIComponent(partnerId)}/report/apply`,
      row,
    ),
  partnerTrends: (s: PlatformSession) => staffRead<PartnerTrend[]>(s, "/v1/partners/trends"),

  // Class courses (class teachers propose, staff with courses:link decide) and My Learning
  classCourses: (s: PlatformSession) => staffRead<StudioOverview>(s, "/v1/class-courses"),
  searchClassCourses: (s: PlatformSession, q: string) =>
    staffRead<StudioCourse[]>(s, `/v1/class-courses/search?q=${encodeURIComponent(q)}`),
  proposeClassCourse: (s: PlatformSession, classId: string, courseRef: string) =>
    result<StudioResult>(s, "POST", "/v1/class-courses/propose", { classId, courseRef }),
  linkClassCourse: (
    s: PlatformSession,
    classId: string,
    courseRef: string,
    prepHoursPerWeek: number,
  ) =>
    result<StudioResult>(s, "POST", "/v1/class-courses/link", {
      classId,
      courseRef,
      prepHoursPerWeek,
    }),
  classCourseStep: (
    s: PlatformSession,
    id: string,
    step: "reject" | "unlink" | "prep",
    body: object,
  ) => result<StudioResult>(s, "POST", `/v1/class-courses/${encodeURIComponent(id)}/${step}`, body),
  classCourseProgress: async (s: PlatformSession, id: string) => {
    const r = await send(s, "GET", `/v1/class-courses/${encodeURIComponent(id)}/progress`);
    if (r.status === 404 || r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as LearnerStudioProgress[];
  },
  myClassCourses: (s: PlatformSession) => staffRead<MyClassCourse[]>(s, "/v1/me/class-courses"),
  myClassLesson: async (s: PlatformSession, ref: string, lessonId: string) => {
    const r = await send(
      s,
      "GET",
      `/v1/me/class-courses/${encodeURIComponent(ref)}/${encodeURIComponent(lessonId)}`,
    );
    if (r.status === 404 || r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as MyLessonView;
  },
  completeClassLesson: (
    s: PlatformSession,
    ref: string,
    lessonId: string,
    answers: Record<string, number>,
    reflections: Record<string, string>,
  ) =>
    result<AuthoringResult & { score?: number | null }>(
      s,
      "POST",
      `/v1/me/class-courses/${encodeURIComponent(ref)}/${encodeURIComponent(lessonId)}/complete`,
      { answers, reflections },
    ),

  // Course Studio (teachers and staff, courses:author) — synthetic courses
  courses: (s: PlatformSession) =>
    staffRead<{ courses: AuthoredCourseSummary[]; canCreate: boolean }>(s, "/v1/courses"),
  course: async (s: PlatformSession, ref: string) => {
    const r = await send(s, "GET", `/v1/courses/${encodeURIComponent(ref)}`);
    if (r.status === 404 || r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as AuthoredCourseDetail;
  },
  createCourse: (s: PlatformSession, title: string, level: string) =>
    result<AuthoringResult>(s, "POST", "/v1/courses", { title, level }),
  saveCourseDraft: (
    s: PlatformSession,
    ref: string,
    content: CourseContent,
    baseRevision: number,
  ) =>
    result<AuthoringResult>(s, "POST", `/v1/courses/${encodeURIComponent(ref)}/draft`, {
      content,
      baseRevision,
    }),
  courseStep: (
    s: PlatformSession,
    ref: string,
    step: "submit" | "withdraw" | "approve" | "return",
    note?: string,
  ) =>
    result<AuthoringResult>(
      s,
      "POST",
      `/v1/courses/${encodeURIComponent(ref)}/${step}`,
      note === undefined ? {} : { note },
    ),

  // Billing (staff; billing:manage by center; an Org Admin decides fee lines) — synthetic, nothing is charged
  billingOptions: (s: PlatformSession) =>
    staffRead<{
      centers: { id: string; name: string }[];
      courseCodes: string[];
      allCenters: boolean;
    }>(s, "/v1/billing/options"),
  billingYears: (s: PlatformSession) => staffRead<string[]>(s, "/v1/billing/years"),
  feeLines: (s: PlatformSession, year: string) =>
    staffRead<FeeLine[]>(s, `/v1/billing/fee-lines?year=${encodeURIComponent(year)}`),
  proposeFeeLine: (s: PlatformSession, d: FeeLineDraft) =>
    result<BillingResult>(s, "POST", "/v1/billing/fee-lines", d),
  decideFeeLine: (
    s: PlatformSession,
    id: string,
    verb: "approve" | "reject" | "retire",
    note = "",
  ) =>
    result<BillingResult>(s, "POST", `/v1/billing/fee-lines/${encodeURIComponent(id)}/${verb}`, {
      note,
    }),
  billingPeriods: (s: PlatformSession) =>
    staffRead<{ year: string; period: string; from: string; to: string; current: boolean }[]>(
      s,
      "/v1/billing/periods",
    ),
  generateInvoices: (s: PlatformSession, year: string, period: string) =>
    result<BillingResult<{ created: number; existing: number; skippedNoLine: string[] }>>(
      s,
      "POST",
      "/v1/billing/invoices/generate",
      { year, period },
    ),
  issueFirstInvoice: (s: PlatformSession, leadId: string) =>
    result<BillingResult<{ invoiceNo: string }>>(s, "POST", "/v1/billing/invoices/first", {
      leadId,
    }),
  invoices: (s: PlatformSession) => staffRead<Invoice[]>(s, "/v1/billing/invoices"),
  recordPayment: (s: PlatformSession, id: string, amountVnd: number, method: PaymentMethod) =>
    result<BillingResult<{ receiptNo: string }>>(
      s,
      "POST",
      `/v1/billing/invoices/${encodeURIComponent(id)}/payments`,
      { amountVnd, method },
    ),
  voidInvoice: (s: PlatformSession, id: string, reason: string) =>
    result<BillingResult>(s, "POST", `/v1/billing/invoices/${encodeURIComponent(id)}/void`, {
      reason,
    }),
  payments: (s: PlatformSession) => staffRead<Payment[]>(s, "/v1/billing/payments"),
  receivables: (s: PlatformSession) => staffRead<Receivables>(s, "/v1/billing/receivables"),
  myBilling: (s: PlatformSession) => staffRead<MyBilling>(s, "/v1/me/billing"),

  myClasses: (s: PlatformSession) => read<MyClass[]>(s, "/v1/me/classes"),
  toMark: (s: PlatformSession) => read<ClassSession[]>(s, "/v1/me/to-mark"),
  classSessions: (s: PlatformSession, classId: string) =>
    read<ClassSession[]>(s, `/v1/classes/${encodeURIComponent(classId)}/sessions`),
  classSummary: (s: PlatformSession, classId: string) =>
    read<AttendanceSummaryRow[]>(
      s,
      `/v1/classes/${encodeURIComponent(classId)}/attendance-summary`,
    ),
  sessionAttendance: (s: PlatformSession, sessionId: string) =>
    read<SessionAttendance>(s, `/v1/sessions/${encodeURIComponent(sessionId)}/attendance`),
  recordAttendance: (
    s: PlatformSession,
    sessionId: string,
    marks: { learnerId: string; mark: AttendanceMark }[],
  ) =>
    result<RecordAttendanceResult>(
      s,
      "PUT",
      `/v1/sessions/${encodeURIComponent(sessionId)}/attendance`,
      {
        marks,
      },
    ),
};
