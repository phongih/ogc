/*
 * Billing & payments — MOCK adapter (SYNTHETIC, browser memory; pattern from EduOS Billing &
 * Payments). NOTHING is charged, paid or invoiced for real: no gateway, no tax invoice, no export.
 *
 * Owner decisions 22/11 (see packages/contracts/src/billing.ts):
 *  - fee lines: staff propose, an Org Admin approves (maker-checker — never their own proposal);
 *    only approved lines are invoiced; an approved line is never edited, only retired;
 *  - invoices: one per learner per fee line, ever (generating twice creates nothing new);
 *    a referrer's wallet credit is applied when their next invoice is issued;
 *  - a referral's first invoice, once paid in full, moves the lead to "enrolled and paid";
 *  - overdue never blocks learning: Receivables + a Decision Engine rule for staff.
 * Center staff act within their access policy's centers (`billing:manage`, IIOS-decided).
 */
import type {
  BillingPort,
  BillingResult,
  FeeLine,
  FeeLineDraft,
  FeeLineStatus,
  IiosGrantedContext,
  Invoice,
  InvoiceLine,
  MyBilling,
  Payment,
  PaymentMethod,
  Receivables,
} from "@ogc/contracts";
import { centers, organizations } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { classes, rosters } from "../../fixtures/teaching";
import { members, personaMap } from "../../fixtures/personas";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { allows, centerScope, inScope } from "./accessPolicy";
import { displayNameOf, ogcAccountOf, staffOrgOf } from "./viewer";
import { consumeCredit, refundCredit, walletBalanceOf } from "./mockGrowth";
import { attachFirstInvoice, leadForBilling, markLeadPaid } from "./mockAdmissions";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
type Refusal = Exclude<BillingResult, { ok: true }>;
const refuse = (reason: Refusal["reason"], detail?: string) =>
  latency<Refusal>({ ok: false, reason, ...(detail ? { detail } : {}) });

const DAY = 86_400_000;
/** Today's date at the center (YYYY-MM-DD, Asia/Ho_Chi_Minh). */
export const centerToday = (now = Date.now()) =>
  new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
const dayNo = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY);
const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// ── state ───────────────────────────────────────────────────────────────────────────────────

interface StoredLine {
  id: string;
  orgId: string;
  year: string;
  courseCode: string;
  centerId: string | null;
  kind: FeeLine["kind"];
  period: string;
  from: string;
  to: string;
  dueDate: string;
  amountVnd: number;
  status: FeeLineStatus;
  proposedBy: string;
  proposedByPrincipal: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}

interface StoredInvoice {
  id: string;
  no: string;
  orgId: string;
  centerId: string;
  learnerName: string;
  billTo: Invoice["billTo"];
  payerPrincipalId: string | null;
  lines: InvoiceLine[];
  subtotalVnd: number;
  creditAppliedVnd: number;
  issuedAt: string;
  dueDate: string;
  payments: Payment[];
  voided: { reason: string; at: string } | null;
}

const lines = new Map<string, StoredLine>();
const invoices = new Map<string, StoredInvoice>();
let seq = { line: 0, invoice: 0, receipt: 0 };

const NOVA = organizations[0].id;
const SAM = "Sam (Org Staff)";
const OLIVIA = "Olivia (Org Admin)";
const principalOfName = (name: string) =>
  members.find((m) => m.displayName === name)?.principalId ?? name;

function addLine(l: Omit<StoredLine, "id">): StoredLine {
  const line = { ...l, id: `FL-${++seq.line}` };
  lines.set(line.id, line);
  return line;
}

/** The school year running at the center today (from August), e.g. 2026 for "2026-2027". */
export const schoolYearStart = (now = Date.now()) => {
  const t = centerToday(now);
  return Number(t.slice(5, 7)) >= 8 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
};

/**
 * Synthetic fee plan for Nova for the CURRENT school year (so a period is always running, whatever
 * the date) + Term 1 invoices (most paid, two unpaid, one part-paid).
 */
function seed() {
  const y = schoolYearStart();
  const yr = `${y}-${y + 1}`;
  const terms = [
    { period: "Term 1", from: `${y}-09-01`, to: `${y}-11-30`, dueDate: `${y}-09-15` },
    { period: "Term 2", from: `${y}-12-01`, to: `${y + 1}-02-28`, dueDate: `${y}-12-10` },
    { period: "Term 3", from: `${y + 1}-03-01`, to: `${y + 1}-05-31`, dueDate: `${y + 1}-03-10` },
    { period: "Summer", from: `${y + 1}-06-01`, to: `${y + 1}-08-31`, dueDate: `${y + 1}-06-10` },
  ];
  const tuition: Record<string, number> = {
    "ENG-A2": 6_900_000,
    "ENG-B1": 8_400_000,
    "IELTS-B2": 12_000_000,
  };
  for (const [courseCode, amountVnd] of Object.entries(tuition))
    for (const t of terms)
      addLine({
        orgId: NOVA,
        year: yr,
        courseCode,
        centerId: null,
        kind: "tuition",
        ...t,
        amountVnd,
        status: "approved",
        proposedBy: SAM,
        proposedByPrincipal: principalOfName(SAM),
        proposedAt: `${y}-08-01T02:00:00.000Z`,
        decidedBy: OLIVIA,
        decidedAt: `${y}-08-02T02:00:00.000Z`,
        note: null,
      });
  // Waiting for an Org Admin: a materials fee for A2, Term 2.
  addLine({
    orgId: NOVA,
    year: yr,
    courseCode: "ENG-A2",
    centerId: null,
    kind: "materials",
    ...terms[1],
    amountVnd: 450_000,
    status: "pending",
    proposedBy: SAM,
    proposedByPrincipal: principalOfName(SAM),
    proposedAt: new Date().toISOString(),
    decidedBy: null,
    decidedAt: null,
    note: null,
  });
  // Term 1 invoices, issued 25/08. Paid on 10/09 except: An P. part-paid, Huy D. and Vy H. unpaid.
  // (Seeded before Term 1 started? Then they are simply not due yet.)
  const unpaid = new Set(["Huy D.", "Vy H."]);
  for (const c of classes.filter((x) => x.orgId === NOVA))
    for (const r of rosters[c.id] ?? []) {
      const fee = resolveLines(NOVA, courseCodeOf(c.courseId), c.centerId, yr, "Term 1") ?? [];
      const inv = createInvoice(
        NOVA,
        c.centerId,
        r.learnerId,
        r.displayName,
        `${y}-08-25T02:00:00.000Z`,
        fee,
      );
      if (!inv || unpaid.has(r.displayName)) continue;
      const amount = r.displayName === "An P." ? 3_000_000 : inv.subtotalVnd - inv.creditAppliedVnd;
      inv.payments.push(paymentOf(inv, amount, "bank_transfer", SAM, `${y}-09-10T03:00:00.000Z`));
    }
}

function reset() {
  lines.clear();
  invoices.clear();
  seq = { line: 0, invoice: 0, receipt: 0 };
  seed();
}
sessionStore.onReset(reset);
export const __resetBillingForTests = reset;
registerPersistent("billing", {
  dump: () => ({ lines, invoices, seq }),
  load: (raw) => {
    const r = raw as { lines?: unknown; invoices?: unknown; seq?: typeof seq };
    refill(lines, r.lines);
    refill(invoices, r.invoices);
    seq = { line: 0, invoice: 0, receipt: 0, ...(r.seq ?? {}) };
  },
});

// ── lookups ─────────────────────────────────────────────────────────────────────────────────

const courseCodeOf = (courseId: string) => courses.find((c) => c.id === courseId)?.code ?? "";
const centerNameOf = (id: string | null) =>
  id === null ? "All centers" : (centers.find((c) => c.id === id)?.name ?? "Unknown center");

/** Who pays for a learner: their guardian, or the learner themselves when an adult with an account. */
function payerOf(orgId: string, learnerId: string): { principalId: string; name: string } | null {
  for (const m of members) {
    if (m.orgId !== orgId) continue;
    const p = personaMap[m.personaId];
    if (!p) continue;
    if (m.role === "guardian" && p.linkedLearnerIds?.includes(learnerId))
      return { principalId: m.principalId, name: m.displayName };
    if (m.role === "learner" && p.adult && p.learnerId === learnerId)
      return { principalId: m.principalId, name: m.displayName };
  }
  return null;
}

/** Approved lines for a course at a center for one period; a center's own line beats "all centers". */
function resolveLines(
  orgId: string,
  courseCode: string,
  centerId: string,
  year: string,
  period: string,
): StoredLine[] | null {
  const match = [...lines.values()].filter(
    (l) =>
      l.orgId === orgId &&
      l.status === "approved" &&
      l.courseCode === courseCode &&
      l.year === year &&
      l.period === period &&
      (l.centerId === null || l.centerId === centerId),
  );
  const byKind = new Map<string, StoredLine>();
  for (const l of match) {
    const cur = byKind.get(l.kind);
    if (!cur || (cur.centerId === null && l.centerId !== null)) byKind.set(l.kind, l);
  }
  const out = [...byKind.values()];
  return out.some((l) => l.kind === "tuition") ? out : null;
}

const describe = (l: StoredLine) =>
  `${l.courseCode} · ${l.kind === "tuition" ? "Tuition" : "Materials"} · ${l.period} ${l.year}`;

const paidOf = (i: StoredInvoice) => i.payments.reduce((t, p) => t + p.amountVnd, 0);
const totalOf = (i: StoredInvoice) => i.subtotalVnd - i.creditAppliedVnd;
const fmt = (vnd: number) => `${vnd.toLocaleString("vi-VN")} ₫`;

/** An invoice is never due before MIN_DAYS_TO_PAY days after it is issued (owner 22/11: a
 *  first invoice issued on 22/11 for Term 1 showed "68 days overdue" at once). */
export const MIN_DAYS_TO_PAY = 7;
/** A first invoice skips a period that ends within this many days and bills the next one. */
export const FIRST_INVOICE_MIN_DAYS_LEFT = 30;
function dueDateFor(lineDues: string[], issuedAt: string): string {
  const earliest = new Date(Date.parse(issuedAt) + 7 * 3_600_000 + MIN_DAYS_TO_PAY * DAY)
    .toISOString()
    .slice(0, 10);
  const due = [...lineDues].sort()[0];
  return due > earliest ? due : earliest;
}

function createInvoice(
  orgId: string,
  centerId: string,
  learnerId: string,
  learnerName: string,
  issuedAt: string,
  fee: StoredLine[],
  billTo: Invoice["billTo"] = { kind: "learner", learnerId },
): StoredInvoice | null {
  if (fee.length === 0) return null;
  const payer = billTo.kind === "learner" ? payerOf(orgId, learnerId) : null;
  const year = issuedAt.slice(0, 4);
  const inv: StoredInvoice = {
    id: `I-${seq.invoice + 1}`,
    no: `INV-${year}-${String(++seq.invoice).padStart(4, "0")}`,
    orgId,
    centerId,
    learnerName,
    billTo,
    payerPrincipalId: payer?.principalId ?? null,
    lines: fee.map((l) => ({ feeLineId: l.id, description: describe(l), amountVnd: l.amountVnd })),
    subtotalVnd: fee.reduce((t, l) => t + l.amountVnd, 0),
    creditAppliedVnd: 0,
    issuedAt,
    dueDate: dueDateFor(
      fee.map((l) => l.dueDate),
      issuedAt,
    ),
    payments: [],
    voided: null,
  };
  if (payer)
    inv.creditAppliedVnd = consumeCredit(
      payer.principalId,
      inv.subtotalVnd,
      `Applied to ${inv.no} (${learnerName})`,
    );
  invoices.set(inv.id, inv);
  return inv;
}

function paymentOf(
  inv: StoredInvoice,
  amountVnd: number,
  method: PaymentMethod,
  by: string,
  at = new Date().toISOString(),
): Payment {
  return {
    id: `P-${seq.receipt + 1}`,
    invoiceId: inv.id,
    invoiceNo: inv.no,
    learnerName: inv.learnerName,
    at,
    amountVnd,
    method,
    receiptNo: `RC-${at.slice(0, 4)}-${String(++seq.receipt).padStart(4, "0")}`,
    recordedBy: by,
  };
}

function statusOf(i: StoredInvoice): Invoice["status"] {
  if (i.voided) return "void";
  const paid = paidOf(i);
  if (paid >= totalOf(i)) return "paid";
  return paid > 0 ? "partially_paid" : "issued";
}

function view(i: StoredInvoice, now = Date.now()): Invoice {
  const status = statusOf(i);
  const paid = paidOf(i);
  const open = status === "issued" || status === "partially_paid";
  return {
    id: i.id,
    no: i.no,
    centerId: i.centerId,
    centerName: centerNameOf(i.centerId),
    learnerName: i.learnerName,
    billTo: i.billTo,
    payerName: i.payerPrincipalId
      ? (members.find((m) => m.principalId === i.payerPrincipalId)?.displayName ?? null)
      : null,
    lines: i.lines.map((l) => ({ ...l })),
    subtotalVnd: i.subtotalVnd,
    creditAppliedVnd: i.creditAppliedVnd,
    totalVnd: totalOf(i),
    paidVnd: paid,
    balanceVnd: status === "void" ? 0 : Math.max(0, totalOf(i) - paid),
    status,
    issuedAt: i.issuedAt,
    dueDate: i.dueDate,
    daysOverdue: open ? Math.max(0, dayNo(centerToday(now)) - dayNo(i.dueDate)) : 0,
    payments: i.payments.map((p) => ({ ...p })),
    voidReason: i.voided?.reason ?? null,
  };
}

const lineView = (l: StoredLine, viewer: IiosGrantedContext): FeeLine => ({
  id: l.id,
  year: l.year,
  courseCode: l.courseCode,
  centerId: l.centerId,
  centerName: centerNameOf(l.centerId),
  kind: l.kind,
  period: l.period,
  from: l.from,
  to: l.to,
  dueDate: l.dueDate,
  amountVnd: l.amountVnd,
  status: l.status,
  proposedBy: l.proposedBy,
  proposedAt: l.proposedAt,
  decidedBy: l.decidedBy,
  decidedAt: l.decidedAt,
  note: l.note,
  mine: l.proposedByPrincipal === viewer.principalId,
});

/** Invoices of the staff member's org, within the centers their policy allows for billing. */
function scopedInvoices(viewer: IiosGrantedContext): StoredInvoice[] | null {
  const org = staffOrgOf(viewer);
  if (!org) return null;
  const scope = centerScope(viewer, "billing:manage");
  return [...invoices.values()].filter((i) => i.orgId === org && inScope(scope, i.centerId));
}

function invoiceForWrite(viewer: IiosGrantedContext, id: string): StoredInvoice | Refusal {
  const org = staffOrgOf(viewer);
  if (!org) return { ok: false, reason: "not_staff" };
  const inv = invoices.get(id);
  if (!inv || inv.orgId !== org) return { ok: false, reason: "not_found" };
  if (!allows(viewer, "billing:manage", { centerId: inv.centerId }))
    return { ok: false, reason: "access_policy" };
  return inv;
}
const refused = (x: unknown): x is Refusal =>
  !!x && typeof x === "object" && "ok" in x && (x as Refusal).ok === false;

function lineForDecision(viewer: IiosGrantedContext, id: string): StoredLine | Refusal {
  const org = staffOrgOf(viewer);
  if (!org) return { ok: false, reason: "not_staff" };
  if (!viewer.orgAdmin) return { ok: false, reason: "not_org_admin" };
  const l = lines.get(id);
  if (!l || l.orgId !== org) return { ok: false, reason: "not_found" };
  return l;
}

function draftIssues(orgId: string, d: FeeLineDraft): string | null {
  const m = /^(\d{4})-(\d{4})$/.exec(d.year);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) return "school year must look like 2026-2027";
  if (!courses.some((c) => c.orgId === orgId && c.code === d.courseCode)) return "unknown course";
  if (d.centerId !== null && !centers.some((c) => c.orgId === orgId && c.id === d.centerId))
    return "unknown center";
  if (d.kind !== "tuition" && d.kind !== "materials") return "unknown fee kind";
  if (d.period.trim().length < 2 || d.period.trim().length > 30) return "period: 2–30 characters";
  if (![d.from, d.to, d.dueDate].every(isYmd)) return "dates must be YYYY-MM-DD";
  if (d.from > d.to) return "the period ends before it starts";
  if (d.dueDate > d.to) return "the due date is after the period ends";
  if (!Number.isInteger(d.amountVnd) || d.amountVnd < 1_000 || d.amountVnd > 500_000_000)
    return "amount must be 1,000–500,000,000 VND";
  const clash = [...lines.values()].some(
    (l) =>
      l.orgId === orgId &&
      (l.status === "approved" || l.status === "pending") &&
      l.year === d.year &&
      l.courseCode === d.courseCode &&
      l.centerId === d.centerId &&
      l.kind === d.kind &&
      l.period === d.period.trim(),
  );
  return clash
    ? "a line for this course, center, fee and period already exists — retire it first"
    : null;
}

/** Current Students (staff with billing access): a learner's invoices, void excluded. */
export function listInvoicesOfLearner(
  orgId: string,
  learnerId: string,
  now = Date.now(),
): Invoice[] {
  return [...invoices.values()]
    .filter(
      (i) =>
        i.orgId === orgId &&
        !i.voided &&
        i.billTo.kind === "learner" &&
        i.billTo.learnerId === learnerId,
    )
    .map((i) => view(i, now));
}

/** Decision Engine: open invoices of an org overdue by at least `days` (center time). */
export function overdueInvoicesOf(orgId: string, days: number, now = Date.now()): Invoice[] {
  return [...invoices.values()]
    .filter((i) => i.orgId === orgId)
    .map((i) => view(i, now))
    .filter((i) => i.daysOverdue >= days)
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

// ── port ────────────────────────────────────────────────────────────────────────────────────

export const mockBilling: BillingPort = {
  years: (viewer) =>
    withFault("billing.years", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<string[] | null>(null);
      const ys = new Set([...lines.values()].filter((l) => l.orgId === org).map((l) => l.year));
      const now = Number(centerToday().slice(0, 4));
      const cur = Number(centerToday().slice(5, 7)) >= 8 ? now : now - 1; // school year from August
      ys.add(`${cur}-${cur + 1}`);
      ys.add(`${cur + 1}-${cur + 2}`);
      return latency([...ys].sort());
    }),

  listFeeLines: (viewer, year) =>
    withFault("billing.listFeeLines", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<FeeLine[] | null>(null);
      const order: Record<FeeLineStatus, number> = {
        pending: 0,
        approved: 1,
        rejected: 2,
        retired: 3,
      };
      return latency(
        [...lines.values()]
          .filter((l) => l.orgId === org && l.year === year)
          .sort(
            (a, b) =>
              order[a.status] - order[b.status] ||
              a.courseCode.localeCompare(b.courseCode) ||
              a.from.localeCompare(b.from) ||
              a.kind.localeCompare(b.kind),
          )
          .map((l) => lineView(l, viewer)),
      );
    }),

  proposeFeeLine: (viewer, draft) =>
    withFault("billing.proposeFeeLine", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      const facts = draft.centerId ? { centerId: draft.centerId } : {};
      if (!allows(viewer, "billing:manage", facts)) return refuse("access_policy");
      const bad = draftIssues(org, draft);
      if (bad) return refuse("invalid", bad);
      addLine({
        orgId: org,
        year: draft.year,
        courseCode: draft.courseCode,
        centerId: draft.centerId,
        kind: draft.kind,
        period: draft.period.trim(),
        from: draft.from,
        to: draft.to,
        dueDate: draft.dueDate,
        amountVnd: draft.amountVnd,
        status: "pending",
        proposedBy: displayNameOf(viewer),
        proposedByPrincipal: viewer.principalId,
        proposedAt: new Date().toISOString(),
        decidedBy: null,
        decidedAt: null,
        note: null,
      });
      return latency<BillingResult>({ ok: true });
    }),

  approveFeeLine: (viewer, id) =>
    withFault("billing.approveFeeLine", () => {
      const l = lineForDecision(viewer, id);
      if (refused(l)) return latency(l);
      if (l.status !== "pending")
        return refuse("invalid_step", "only a pending line can be approved");
      if (l.proposedByPrincipal === viewer.principalId)
        return refuse("own_proposal", "another Org Admin must approve your own proposal");
      const clash = [...lines.values()].some(
        (o) =>
          o.id !== l.id &&
          o.orgId === l.orgId &&
          o.status === "approved" &&
          o.year === l.year &&
          o.courseCode === l.courseCode &&
          o.centerId === l.centerId &&
          o.kind === l.kind &&
          o.period === l.period,
      );
      if (clash)
        return refuse("invalid_step", "an approved line already covers this — retire it first");
      l.status = "approved";
      l.decidedBy = displayNameOf(viewer);
      l.decidedAt = new Date().toISOString();
      return latency<BillingResult>({ ok: true });
    }),

  rejectFeeLine: (viewer, id, note) =>
    withFault("billing.rejectFeeLine", () => {
      const l = lineForDecision(viewer, id);
      if (refused(l)) return latency(l);
      if (l.status !== "pending")
        return refuse("invalid_step", "only a pending line can be rejected");
      if (note.trim().length < 3) return refuse("invalid", "give a reason");
      l.status = "rejected";
      l.decidedBy = displayNameOf(viewer);
      l.decidedAt = new Date().toISOString();
      l.note = note.trim();
      return latency<BillingResult>({ ok: true });
    }),

  retireFeeLine: (viewer, id, note) =>
    withFault("billing.retireFeeLine", () => {
      const l = lineForDecision(viewer, id);
      if (refused(l)) return latency(l);
      if (l.status !== "approved")
        return refuse("invalid_step", "only an approved line can be retired");
      if (note.trim().length < 3) return refuse("invalid", "give a reason");
      l.status = "retired"; // invoices already issued keep their amounts
      l.decidedBy = displayNameOf(viewer);
      l.decidedAt = new Date().toISOString();
      l.note = note.trim();
      return latency<BillingResult>({ ok: true });
    }),

  periods: (viewer) =>
    withFault("billing.periods", () => {
      type P = { year: string; period: string; from: string; to: string; current: boolean };
      const org = staffOrgOf(viewer);
      if (!org) return latency<P[] | null>(null);
      const seen = new Map<string, P>();
      for (const l of lines.values())
        if (l.orgId === org && l.status === "approved" && l.kind === "tuition")
          seen.set(`${l.year}|${l.period}`, {
            year: l.year,
            period: l.period,
            from: l.from,
            to: l.to,
            current: false,
          });
      const list = [...seen.values()].sort((a, b) => a.from.localeCompare(b.from));
      const today = centerToday();
      const cur = list.find((p) => p.to >= today);
      if (cur) cur.current = true;
      return latency(list);
    }),

  generateInvoices: (viewer, year, period) =>
    withFault("billing.generateInvoices", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      const scope = centerScope(viewer, "billing:manage");
      if (scope === "none" || (Array.isArray(scope) && scope.length === 0))
        return refuse("access_policy");
      let created = 0;
      let existing = 0;
      const skipped = new Set<string>();
      const invoicedLines = (learnerId: string) =>
        new Set(
          [...invoices.values()]
            .filter(
              (i) => !i.voided && i.billTo.kind === "learner" && i.billTo.learnerId === learnerId,
            )
            .flatMap((i) => i.lines.map((x) => x.feeLineId)),
        );
      const done = new Set<string>(); // a learner in two classes of one course is billed once
      for (const c of classes.filter((x) => x.orgId === org && inScope(scope, x.centerId))) {
        const fee = resolveLines(org, courseCodeOf(c.courseId), c.centerId, year, period);
        if (!fee) {
          skipped.add(`${courseCodeOf(c.courseId)} · ${centerNameOf(c.centerId)}`);
          continue;
        }
        for (const r of rosters[c.id] ?? []) {
          const k = `${r.learnerId}|${courseCodeOf(c.courseId)}`;
          if (done.has(k)) continue;
          done.add(k);
          const have = invoicedLines(r.learnerId);
          const todo = fee.filter((l) => !have.has(l.id));
          if (todo.length === 0) {
            existing++;
            continue;
          }
          createInvoice(
            org,
            c.centerId,
            r.learnerId,
            r.displayName,
            new Date().toISOString(),
            todo,
          );
          created++;
        }
      }
      return latency<BillingResult<{ created: number; existing: number; skippedNoLine: string[] }>>(
        {
          ok: true,
          created,
          existing,
          skippedNoLine: [...skipped],
        },
      );
    }),

  issueFirstInvoice: (viewer, leadId) =>
    withFault("billing.issueFirstInvoice", () => {
      const org = staffOrgOf(viewer);
      if (!org) return refuse("not_staff");
      const lead = leadForBilling(leadId);
      if (!lead || lead.orgId !== org) return refuse("not_found");
      const center = centers.find((c) => c.orgId === org && c.id === lead.centerId);
      if (!center) return refuse("not_found");
      if (!allows(viewer, "billing:manage", { centerId: center.id }))
        return refuse("access_policy");
      if (lead.stage !== "placement")
        return refuse("invalid_step", "record the placement test in Admissions first");
      if (lead.invoiceNo) return refuse("invalid_step", `already invoiced: ${lead.invoiceNo}`);
      // The period running today, else the next one to start; a running period that ends within
      // FIRST_INVOICE_MIN_DAYS_LEFT days is skipped when a later one exists.
      const today = centerToday();
      const tuition = [...lines.values()]
        .filter(
          (l) =>
            l.orgId === org &&
            l.status === "approved" &&
            l.kind === "tuition" &&
            l.courseCode === lead.courseCode &&
            (l.centerId === null || l.centerId === center.id) &&
            l.to >= today,
        )
        .sort((a, b) => a.from.localeCompare(b.from));
      const endsSoon = (l: StoredLine) =>
        l.from <= today && dayNo(l.to) - dayNo(today) < FIRST_INVOICE_MIN_DAYS_LEFT;
      const pick = tuition[0] && endsSoon(tuition[0]) && tuition[1] ? tuition[1] : tuition[0];
      const fee = pick
        ? resolveLines(org, lead.courseCode, center.id, pick.year, pick.period)
        : null;
      if (!fee)
        return refuse(
          "no_fee_line",
          `no approved fee line for ${lead.courseCode} at ${center.name} — approve one in Fee plans`,
        );
      const inv = createInvoice(
        org,
        center.id,
        lead.id,
        lead.learnerName,
        new Date().toISOString(),
        fee,
        {
          kind: "lead",
          leadId: lead.id,
        },
      )!;
      attachFirstInvoice(lead.id, inv.no, displayNameOf(viewer));
      return latency<BillingResult<{ invoiceNo: string }>>({ ok: true, invoiceNo: inv.no });
    }),

  listInvoices: (viewer) =>
    withFault("billing.listInvoices", () => {
      const list = scopedInvoices(viewer);
      if (!list) return latency<Invoice[] | null>(null);
      return latency(list.map((i) => view(i)).sort((a, b) => (a.no < b.no ? 1 : -1)));
    }),

  recordPayment: (viewer, invoiceId, amountVnd, method) =>
    withFault("billing.recordPayment", () => {
      const inv = invoiceForWrite(viewer, invoiceId);
      if (refused(inv)) return latency(inv);
      const v = view(inv);
      if (v.status === "void" || v.status === "paid")
        return refuse(
          "invalid_step",
          `invoice is ${v.status === "void" ? "void" : "already paid"}`,
        );
      if (!["cash", "bank_transfer", "card"].includes(method))
        return refuse("invalid", "unknown method");
      if (!Number.isInteger(amountVnd) || amountVnd <= 0 || amountVnd > v.balanceVnd)
        return refuse("invalid", `amount must be 1–${fmt(v.balanceVnd)}`);
      const p = paymentOf(inv, amountVnd, method, displayNameOf(viewer));
      inv.payments.push(p);
      if (inv.billTo.kind === "lead" && statusOf(inv) === "paid")
        markLeadPaid(inv.billTo.leadId, totalOf(inv), displayNameOf(viewer));
      return latency<BillingResult<{ receiptNo: string }>>({ ok: true, receiptNo: p.receiptNo });
    }),

  voidInvoice: (viewer, invoiceId, reason) =>
    withFault("billing.voidInvoice", () => {
      const inv = invoiceForWrite(viewer, invoiceId);
      if (refused(inv)) return latency(inv);
      if (inv.voided) return refuse("invalid_step", "already void");
      if (inv.payments.length) return refuse("invalid_step", "payments recorded — cannot void");
      if (reason.trim().length < 3) return refuse("invalid", "give a reason");
      inv.voided = { reason: reason.trim(), at: new Date().toISOString() };
      if (inv.payerPrincipalId && inv.creditAppliedVnd > 0)
        refundCredit(inv.payerPrincipalId, inv.creditAppliedVnd, `Returned from void ${inv.no}`);
      if (inv.billTo.kind === "lead")
        attachFirstInvoice(inv.billTo.leadId, null, displayNameOf(viewer));
      return latency<BillingResult>({ ok: true });
    }),

  listPayments: (viewer) =>
    withFault("billing.listPayments", () => {
      const list = scopedInvoices(viewer);
      if (!list) return latency<Payment[] | null>(null);
      return latency(
        list
          .flatMap((i) => i.payments.map((p) => ({ ...p })))
          .sort((a, b) =>
            a.at < b.at ? 1 : a.at > b.at ? -1 : b.receiptNo.localeCompare(a.receiptNo),
          ),
      );
    }),

  getReceivables: (viewer) =>
    withFault("billing.getReceivables", () => {
      const list = scopedInvoices(viewer);
      if (!list) return latency<Receivables | null>(null);
      const vs = list.map((i) => view(i)).filter((v) => v.status !== "void");
      const byCenter = new Map<string, Receivables["byCenter"][number]>();
      for (const v of vs) {
        if (v.balanceVnd <= 0) continue;
        const row = byCenter.get(v.centerId) ?? {
          centerId: v.centerId,
          centerName: v.centerName,
          notDueVnd: 0,
          d1to30Vnd: 0,
          d31to60Vnd: 0,
          over60Vnd: 0,
        };
        const d = v.daysOverdue;
        if (d <= 0) row.notDueVnd += v.balanceVnd;
        else if (d <= 30) row.d1to30Vnd += v.balanceVnd;
        else if (d <= 60) row.d31to60Vnd += v.balanceVnd;
        else row.over60Vnd += v.balanceVnd;
        byCenter.set(v.centerId, row);
      }
      return latency<Receivables>({
        outstandingVnd: vs.reduce((t, v) => t + v.balanceVnd, 0),
        overdueVnd: vs.filter((v) => v.daysOverdue > 0).reduce((t, v) => t + v.balanceVnd, 0),
        collectedVnd: vs.reduce((t, v) => t + v.paidVnd, 0),
        creditAppliedVnd: vs.reduce((t, v) => t + v.creditAppliedVnd, 0),
        byCenter: [...byCenter.values()].sort((a, b) => a.centerName.localeCompare(b.centerName)),
        overdue: vs.filter((v) => v.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue),
      });
    }),

  getMine: (viewer) =>
    withFault("billing.getMine", () => {
      const persona = ogcAccountOf(viewer);
      const p = persona ? personaMap[persona] : undefined;
      if (!p) return latency<MyBilling | null>(null);
      const payer =
        viewer.role === "guardian" ? !!p.guardianId : viewer.role === "learner" && !!p.adult;
      if (!payer) return latency<MyBilling | null>(null); // a minor's tuition is their guardian's
      const mine = [...invoices.values()]
        .filter((i) => i.orgId === viewer.orgId && i.payerPrincipalId === viewer.principalId)
        .map((i) => view(i))
        .sort((a, b) => (a.no < b.no ? 1 : -1));
      return latency<MyBilling>({
        invoices: mine,
        outstandingVnd: mine.reduce((t, v) => t + v.balanceVnd, 0),
        walletVnd: walletBalanceOf(viewer.principalId),
      });
    }),
};

reset();
