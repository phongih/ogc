/*
 * Billing on the Platform API — the rules of the demo's mock adapter
 * (apps/web/src/lib/adapters/mockBilling.ts, owner decisions 22/11), on PostgreSQL (owner 23/11:
 * "đủ như demo"; no referral wallet yet; a paid first invoice moves the lead only). SYNTHETIC:
 * nothing is charged, paid, invoiced or sent for real.
 *  - fee lines: staff with billing:manage propose; an Org Admin approves / rejects / retires, never
 *    their own proposal; only approved lines are invoiced; an approved line is never edited;
 *  - invoices: one per learner per fee line, ever (generating twice creates nothing new); a
 *    center's own line beats an "all centers" line; never due before 7 days after issue;
 *  - a lead's first invoice (stage "placement") moves it to "offer"; paid in full → "enrolled";
 *    voided → back to "placement" (domains/admissions.ts hooks);
 *  - payments are append-only; an invoice with a payment is never voided;
 *  - overdue never blocks learning: it shows in Receivables only.
 * Staff act within the centers their policy allows for billing:manage (IIOS-decided).
 */
import { sql } from "kysely";
import { authorize } from "@ogc/contracts";
import type {
  BillingRefusal,
  FeeLine,
  FeeLineStatus,
  Invoice,
  InvoiceLine,
  MyBilling,
  Payment,
  PaymentMethod,
  Receivables,
} from "@ogc/contracts";
import type { TenantTx } from "../db.js";
import type { Api, Caller } from "../server.js";
import { attachFirstInvoice, markLeadPaid } from "./admissions.js";

const DAY = 86_400_000;
/** An invoice is never due before this many days after it is issued (owner 22/11). */
export const MIN_DAYS_TO_PAY = 7;
/** A first invoice skips a running period that ends within this many days, if a later one exists. */
export const FIRST_INVOICE_MIN_DAYS_LEFT = 30;
const centerToday = (now: number) => new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
const dayNo = (ymd: string) => Math.floor(Date.parse(`${ymd}T00:00:00Z`) / DAY);
const isYmd = (s: unknown): s is string =>
  typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const METHODS: PaymentMethod[] = ["cash", "bank_transfer", "card"];

type Result<T = object> =
  ({ ok: true } & T) | { ok: false; reason: BillingRefusal; detail?: string };
const no = (reason: BillingRefusal, detail?: string): Result => ({
  ok: false,
  reason,
  ...(detail ? { detail } : {}),
});

interface Line {
  id: string;
  year: string;
  courseCode: string;
  centerId: string | null;
  kind: "tuition" | "materials";
  period: string;
  from: string;
  to: string;
  dueDate: string;
  amountVnd: number;
  status: FeeLineStatus;
  proposedBy: string;
  proposedByName: string;
  proposedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
}
interface Inv {
  id: string;
  no: string;
  centerId: string;
  learnerName: string;
  learnerId: string | null;
  leadId: string | null;
  payerPrincipalId: string | null;
  payerName: string | null;
  lines: InvoiceLine[];
  subtotalVnd: number;
  issuedAt: string;
  dueDate: string;
  voidReason: string | null;
  payments: Payment[];
}

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

async function loadLines(tx: TenantTx): Promise<Line[]> {
  const r = await sql<Record<string, unknown>>`
    select id, year, course_code, center_id, kind, period, from_date::text as f, to_date::text as t,
           due_date::text as d, amount_vnd, status, proposed_by, proposed_by_name, proposed_at,
           decided_by_name, decided_at, note
      from fee_line order by (substring(id from 4))::int`.execute(tx);
  return r.rows.map((x) => ({
    id: x.id as string,
    year: x.year as string,
    courseCode: x.course_code as string,
    centerId: x.center_id as string | null,
    kind: x.kind as Line["kind"],
    period: x.period as string,
    from: x.f as string,
    to: x.t as string,
    dueDate: x.d as string,
    amountVnd: Number(x.amount_vnd),
    status: x.status as FeeLineStatus,
    proposedBy: x.proposed_by as string,
    proposedByName: x.proposed_by_name as string,
    proposedAt: iso(x.proposed_at as Date)!,
    decidedBy: x.decided_by_name as string | null,
    decidedAt: iso(x.decided_at as Date | null),
    note: x.note as string | null,
  }));
}

async function loadInvoices(tx: TenantTx): Promise<Inv[]> {
  const [inv, lines, pays] = await Promise.all([
    sql<Record<string, unknown>>`
      select id, no, center_id, learner_name, learner_id, lead_id, payer_principal_id, payer_name,
             subtotal_vnd, issued_at, due_date::text as d, void_reason
        from invoice order by (substring(id from 3))::int`.execute(tx),
    tx.selectFrom("invoice_line").selectAll().orderBy("fee_line_id").execute(),
    tx.selectFrom("payment").selectAll().execute(),
  ]);
  return inv.rows.map((x) => {
    const id = x.id as string;
    return {
      id,
      no: x.no as string,
      centerId: x.center_id as string,
      learnerName: x.learner_name as string,
      learnerId: x.learner_id as string | null,
      leadId: x.lead_id as string | null,
      payerPrincipalId: x.payer_principal_id as string | null,
      payerName: x.payer_name as string | null,
      lines: lines
        .filter((l) => l.invoice_id === id)
        .map((l) => ({
          feeLineId: l.fee_line_id,
          description: l.description,
          amountVnd: Number(l.amount_vnd),
        })),
      subtotalVnd: Number(x.subtotal_vnd),
      issuedAt: iso(x.issued_at as Date)!,
      dueDate: x.d as string,
      voidReason: x.void_reason as string | null,
      payments: pays
        .filter((p) => p.invoice_id === id)
        .map((p) => ({
          id: p.id,
          invoiceId: id,
          invoiceNo: x.no as string,
          learnerName: x.learner_name as string,
          at: iso(p.at)!,
          amountVnd: Number(p.amount_vnd),
          method: p.method,
          receiptNo: p.receipt_no,
          recordedBy: p.recorded_by,
        }))
        .sort((a, b) =>
          a.at < b.at ? -1 : a.at > b.at ? 1 : a.receiptNo.localeCompare(b.receiptNo),
        ),
    };
  });
}

const paidOf = (i: Inv) => i.payments.reduce((t, p) => t + p.amountVnd, 0);
function statusOf(i: Inv): Invoice["status"] {
  if (i.voidReason) return "void";
  const paid = paidOf(i);
  if (paid >= i.subtotalVnd) return "paid";
  return paid > 0 ? "partially_paid" : "issued";
}

function view(i: Inv, centers: Map<string, string>, now: number): Invoice {
  const status = statusOf(i);
  const paid = paidOf(i);
  const open = status === "issued" || status === "partially_paid";
  return {
    id: i.id,
    no: i.no,
    centerId: i.centerId,
    centerName: centers.get(i.centerId) ?? "Unknown center",
    learnerName: i.learnerName,
    billTo: i.leadId
      ? { kind: "lead", leadId: i.leadId }
      : { kind: "learner", learnerId: i.learnerId! },
    payerName: i.payerName,
    lines: i.lines.map((l) => ({ ...l })),
    subtotalVnd: i.subtotalVnd,
    creditAppliedVnd: 0,
    totalVnd: i.subtotalVnd,
    paidVnd: paid,
    balanceVnd: status === "void" ? 0 : Math.max(0, i.subtotalVnd - paid),
    status,
    issuedAt: i.issuedAt,
    dueDate: i.dueDate,
    daysOverdue: open ? Math.max(0, dayNo(centerToday(now)) - dayNo(i.dueDate)) : 0,
    payments: i.payments.map((p) => ({ ...p })),
    voidReason: i.voidReason,
  };
}

const describe = (l: Line) =>
  `${l.courseCode} · ${l.kind === "tuition" ? "Tuition" : "Materials"} · ${l.period} ${l.year}`;

/** Approved lines for a course at a center for one period; a center's own line beats "all centers". */
function resolveLines(
  all: Line[],
  courseCode: string,
  centerId: string,
  year: string,
  period: string,
): Line[] | null {
  const byKind = new Map<string, Line>();
  for (const l of all) {
    if (
      l.status !== "approved" ||
      l.courseCode !== courseCode ||
      l.year !== year ||
      l.period !== period
    )
      continue;
    if (l.centerId !== null && l.centerId !== centerId) continue;
    const cur = byKind.get(l.kind);
    if (!cur || (cur.centerId === null && l.centerId !== null)) byKind.set(l.kind, l);
  }
  const out = [...byKind.values()];
  return out.some((l) => l.kind === "tuition") ? out : null;
}

function dueDateFor(lineDues: string[], issuedAt: number): string {
  const earliest = new Date(issuedAt + 7 * 3_600_000 + MIN_DAYS_TO_PAY * DAY)
    .toISOString()
    .slice(0, 10);
  const due = [...lineDues].sort()[0];
  return due > earliest ? due : earliest;
}

const fmt = (vnd: number) => `${vnd.toLocaleString("vi-VN")} ₫`;

// ── writes ───────────────────────────────────────────────────────────────────────────────────
async function createInvoice(
  tx: TenantTx,
  orgId: string,
  at: Date,
  bill: { centerId: string; learnerName: string; learnerId: string | null; leadId: string | null },
  fee: Line[],
): Promise<{ id: string; no: string; subtotal: number }> {
  const { rows } = await sql<{ n: number }>`select count(*)::int as n from invoice`.execute(tx);
  const n = rows[0].n + 1;
  const id = `I-${n}`;
  const invNo = `INV-${at.toISOString().slice(0, 4)}-${String(n).padStart(4, "0")}`;
  let payer: { principal: string; name: string } | null = null;
  if (bill.learnerId) {
    const g = await tx
      .selectFrom("guardian_link")
      .select(["guardian_principal_id", "guardian_name"])
      .where("learner_id", "=", bill.learnerId)
      .orderBy("guardian_principal_id")
      .executeTakeFirst();
    if (g)
      payer = {
        principal: g.guardian_principal_id,
        name: g.guardian_name ?? g.guardian_principal_id,
      };
    else {
      const self = await tx
        .selectFrom("learner")
        .select(["principal_id", "display_name", "pays_own_tuition"])
        .where("id", "=", bill.learnerId)
        .executeTakeFirst();
      if (self?.pays_own_tuition && self.principal_id)
        payer = { principal: self.principal_id, name: self.display_name };
    }
  }
  const subtotal = fee.reduce((t, l) => t + l.amountVnd, 0);
  await tx
    .insertInto("invoice")
    .values({
      org_id: orgId,
      id,
      no: invNo,
      center_id: bill.centerId,
      learner_name: bill.learnerName,
      learner_id: bill.learnerId,
      lead_id: bill.leadId,
      payer_principal_id: payer?.principal ?? null,
      payer_name: payer?.name ?? null,
      subtotal_vnd: subtotal,
      issued_at: at,
      due_date: dueDateFor(
        fee.map((l) => l.dueDate),
        at.getTime(),
      ),
      void_reason: null,
      voided_at: null,
    })
    .execute();
  await tx
    .insertInto("invoice_line")
    .values(
      fee.map((l) => ({
        org_id: orgId,
        invoice_id: id,
        fee_line_id: l.id,
        description: describe(l),
        amount_vnd: l.amountVnd,
      })),
    )
    .execute();
  return { id, no: invNo, subtotal };
}

const STATUS: Record<BillingRefusal, number> = {
  not_staff: 403,
  not_org_admin: 403,
  own_proposal: 403,
  access_policy: 403,
  not_found: 404,
  invalid: 422,
  invalid_step: 409,
  no_fee_line: 409,
};

/** Current Students: what each learner still has to pay and how much is overdue (information only). */
export async function tuitionByLearner(
  tx: TenantTx,
  now: number,
): Promise<Map<string, { balanceVnd: number; overdueVnd: number }>> {
  const out = new Map<string, { balanceVnd: number; overdueVnd: number }>();
  for (const i of await loadInvoices(tx)) {
    if (!i.learnerId) continue;
    const v = view(i, new Map(), now);
    const t = out.get(i.learnerId) ?? { balanceVnd: 0, overdueVnd: 0 };
    t.balanceVnd += v.balanceVnd;
    if (v.daysOverdue > 0) t.overdueVnd += v.balanceVnd;
    out.set(i.learnerId, t);
  }
  return out;
}

export function registerBilling(app: Api): void {
  const isStaff = (c: Caller) => c.ctx.role === "staff";
  const mayAt = (c: Caller, centerId?: string) =>
    authorize(c.ctx, "billing:manage", { orgId: c.ctx.orgId, ...(centerId ? { centerId } : {}) })
      .allow;
  const nameOf = async (tx: TenantTx, c: Caller) =>
    (
      await tx
        .selectFrom("staff_member")
        .select("display_name")
        .where("principal_id", "=", c.ctx.principalId)
        .executeTakeFirst()
    )?.display_name ?? c.ctx.principalId;
  const centersOf = async (tx: TenantTx) =>
    new Map(
      (await tx.selectFrom("center").select(["id", "name"]).execute()).map((c) => [c.id, c.name]),
    );

  const read = <T>(
    url: string,
    fn: (tx: TenantTx, caller: Caller, q: Record<string, string>) => Promise<T>,
  ) =>
    app.secured("GET", url, async (caller, req, reply) => {
      if (!isStaff(caller)) return reply.code(403).send({ error: "not_staff" });
      return caller.tenant((tx) => fn(tx, caller, (req.query ?? {}) as Record<string, string>));
    });

  /** A staff write: serialised per organization (billing, then admissions — never the reverse). */
  const write = (
    url: string,
    run: (
      tx: TenantTx,
      caller: Caller,
      body: Record<string, unknown>,
      params: Record<string, string>,
      now: Date,
    ) => Promise<Result<object>>,
  ) =>
    app.secured("POST", url, async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = req.params as Record<string, string>;
      await caller.write<Result<object>>(`POST ${url}`, { params, body }, async (tx) => {
        let r: Result<object>;
        if (!isStaff(caller)) r = no("not_staff");
        else {
          await sql`select pg_advisory_xact_lock(hashtext('billing:' || ${caller.ctx.orgId}))`.execute(
            tx,
          );
          await sql`select pg_advisory_xact_lock(hashtext('admissions:' || ${caller.ctx.orgId}))`.execute(
            tx,
          );
          r = await run(tx, caller, body, params, new Date(caller.now()));
        }
        return {
          status: r.ok ? 200 : STATUS[r.reason],
          body: r,
          audit: {
            action: "billing:manage",
            resource: { ...params },
            outcome: r.ok ? ("allowed" as const) : ("denied" as const),
            ...(r.ok ? { after: body } : { reason: r.reason }),
          },
        };
      });
    });

  // ── fee plans ──────────────────────────────────────────────────────────────────────────────
  read("/v1/billing/years", async (tx, caller) => {
    const ys = new Set((await loadLines(tx)).map((l) => l.year));
    const t = centerToday(caller.now());
    const cur = Number(t.slice(5, 7)) >= 8 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
    ys.add(`${cur}-${cur + 1}`);
    ys.add(`${cur + 1}-${cur + 2}`);
    return [...ys].sort();
  });

  read("/v1/billing/fee-lines", async (tx, caller, q): Promise<FeeLine[]> => {
    const centers = await centersOf(tx);
    const order: Record<FeeLineStatus, number> = {
      pending: 0,
      approved: 1,
      rejected: 2,
      retired: 3,
    };
    return (await loadLines(tx))
      .filter((l) => l.year === q.year)
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          a.courseCode.localeCompare(b.courseCode) ||
          a.from.localeCompare(b.from) ||
          a.kind.localeCompare(b.kind),
      )
      .map((l) => ({
        id: l.id,
        year: l.year,
        courseCode: l.courseCode,
        centerId: l.centerId,
        centerName:
          l.centerId === null ? "All centers" : (centers.get(l.centerId) ?? "Unknown center"),
        kind: l.kind,
        period: l.period,
        from: l.from,
        to: l.to,
        dueDate: l.dueDate,
        amountVnd: l.amountVnd,
        status: l.status,
        proposedBy: l.proposedByName,
        proposedAt: l.proposedAt,
        decidedBy: l.decidedBy,
        decidedAt: l.decidedAt,
        note: l.note,
        mine: l.proposedBy === caller.ctx.principalId,
      }));
  });

  read("/v1/billing/options", async (tx, caller) => ({
    centers: [...(await centersOf(tx))]
      .filter(([id]) => mayAt(caller, id))
      .map(([id, name]) => ({ id, name })),
    courseCodes: (await tx.selectFrom("course").select("code").orderBy("code").execute()).map(
      (c) => c.code,
    ),
    allCenters: mayAt(caller),
  }));

  write("/v1/billing/fee-lines", async (tx, caller, d, _p, now) => {
    const centerId = d.centerId === null || d.centerId === undefined ? null : d.centerId;
    if (centerId !== null && typeof centerId !== "string") return no("invalid", "unknown center");
    if (!mayAt(caller, centerId ?? undefined)) return no("access_policy");
    const m = typeof d.year === "string" ? /^(\d{4})-(\d{4})$/.exec(d.year) : null;
    if (!m || Number(m[2]) !== Number(m[1]) + 1)
      return no("invalid", "school year must look like 2026-2027");
    const courses = (await tx.selectFrom("course").select("code").execute()).map((c) => c.code);
    if (!courses.includes(d.courseCode as string)) return no("invalid", "unknown course");
    if (centerId !== null && !(await centersOf(tx)).has(centerId))
      return no("invalid", "unknown center");
    if (d.kind !== "tuition" && d.kind !== "materials") return no("invalid", "unknown fee kind");
    const period = typeof d.period === "string" ? d.period.trim() : "";
    if (period.length < 2 || period.length > 30) return no("invalid", "period: 2–30 characters");
    if (![d.from, d.to, d.dueDate].every(isYmd)) return no("invalid", "dates must be YYYY-MM-DD");
    if ((d.from as string) > (d.to as string))
      return no("invalid", "the period ends before it starts");
    if ((d.dueDate as string) > (d.to as string))
      return no("invalid", "the due date is after the period ends");
    const amount = d.amountVnd;
    if (
      typeof amount !== "number" ||
      !Number.isInteger(amount) ||
      amount < 1_000 ||
      amount > 500_000_000
    )
      return no("invalid", "amount must be 1,000–500,000,000 VND");
    const all = await loadLines(tx);
    const clash = all.some(
      (l) =>
        (l.status === "approved" || l.status === "pending") &&
        l.year === d.year &&
        l.courseCode === d.courseCode &&
        l.centerId === centerId &&
        l.kind === d.kind &&
        l.period === period,
    );
    if (clash)
      return no(
        "invalid",
        "a line for this course, center, fee and period already exists — retire it first",
      );
    const id = `FL-${Math.max(0, ...all.map((l) => Number(l.id.slice(3)))) + 1}`;
    await tx
      .insertInto("fee_line")
      .values({
        org_id: caller.ctx.orgId,
        id,
        year: d.year as string,
        course_code: d.courseCode as string,
        center_id: centerId,
        kind: d.kind,
        period,
        from_date: d.from as string,
        to_date: d.to as string,
        due_date: d.dueDate as string,
        amount_vnd: amount,
        status: "pending",
        proposed_by: caller.ctx.principalId,
        proposed_by_name: await nameOf(tx, caller),
        proposed_at: now,
        decided_by_name: null,
        decided_at: null,
        note: null,
      })
      .execute();
    return { ok: true, id };
  });

  /** An Org Admin's decision on a line of their organization. */
  const decide = (verb: "approve" | "reject" | "retire") =>
    write(`/v1/billing/fee-lines/:id/${verb}`, async (tx, caller, d, p, now) => {
      if (!caller.ctx.orgAdmin) return no("not_org_admin");
      const all = await loadLines(tx);
      const l = all.find((x) => x.id === p.id);
      if (!l) return no("not_found");
      const note = typeof d.note === "string" ? d.note.trim() : "";
      if (verb === "approve") {
        if (l.status !== "pending")
          return no("invalid_step", "only a pending line can be approved");
        if (l.proposedBy === caller.ctx.principalId)
          return no("own_proposal", "another Org Admin must approve your own proposal");
        const covered = all.some(
          (o) =>
            o.id !== l.id &&
            o.status === "approved" &&
            o.year === l.year &&
            o.courseCode === l.courseCode &&
            o.centerId === l.centerId &&
            o.kind === l.kind &&
            o.period === l.period,
        );
        if (covered)
          return no("invalid_step", "an approved line already covers this — retire it first");
      } else {
        const need = verb === "reject" ? "pending" : "approved";
        if (l.status !== need)
          return no(
            "invalid_step",
            `only ${need === "pending" ? "a pending" : "an approved"} line can be ${verb}d`,
          );
        if (note.length < 3) return no("invalid", "give a reason");
      }
      const status = verb === "approve" ? "approved" : verb === "reject" ? "rejected" : "retired";
      await tx
        .updateTable("fee_line")
        .set({
          status,
          decided_by_name: await nameOf(tx, caller),
          decided_at: now,
          note: verb === "approve" ? null : note.slice(0, 200),
        })
        .where("id", "=", l.id)
        .execute();
      return { ok: true };
    });
  decide("approve");
  decide("reject");
  decide("retire");

  // ── invoices ───────────────────────────────────────────────────────────────────────────────
  read("/v1/billing/periods", async (tx, caller) => {
    type P = { year: string; period: string; from: string; to: string; current: boolean };
    const seen = new Map<string, P>();
    for (const l of await loadLines(tx))
      if (l.status === "approved" && l.kind === "tuition")
        seen.set(`${l.year}|${l.period}`, {
          year: l.year,
          period: l.period,
          from: l.from,
          to: l.to,
          current: false,
        });
    const list = [...seen.values()].sort((a, b) => a.from.localeCompare(b.from));
    const cur = list.find((x) => x.to >= centerToday(caller.now()));
    if (cur) cur.current = true;
    return list;
  });

  write("/v1/billing/invoices/generate", async (tx, caller, d, _p, now) => {
    const centers = await centersOf(tx);
    const scope = [...centers.keys()].filter((id) => mayAt(caller, id));
    if (!scope.length) return no("access_policy");
    if (typeof d.year !== "string" || typeof d.period !== "string")
      return no("invalid", "year and period");
    const all = await loadLines(tx);
    const invs = await loadInvoices(tx);
    const classes = await sql<{ id: string; center_id: string; code: string }>`
      select k.id, k.center_id, co.code from class k join course co on co.id = k.course_id order by k.id`.execute(
      tx,
    );
    const roster = await tx
      .selectFrom("roster")
      .innerJoin("learner", "learner.id", "roster.learner_id")
      .select(["roster.class_id", "learner.id", "learner.display_name"])
      .orderBy("learner.id")
      .execute();
    let created = 0;
    let existing = 0;
    const skipped = new Set<string>();
    const done = new Set<string>(); // a learner in two classes of one course is billed once
    for (const k of classes.rows.filter((x) => scope.includes(x.center_id))) {
      const fee = resolveLines(all, k.code, k.center_id, d.year, d.period);
      if (!fee) {
        skipped.add(`${k.code} · ${centers.get(k.center_id)}`);
        continue;
      }
      for (const r of roster.filter((x) => x.class_id === k.id)) {
        const key = `${r.id}|${k.code}`;
        if (done.has(key)) continue;
        done.add(key);
        const have = new Set(
          invs
            .filter((i) => !i.voidReason && i.learnerId === r.id)
            .flatMap((i) => i.lines.map((x) => x.feeLineId)),
        );
        const todo = fee.filter((l) => !have.has(l.id));
        if (!todo.length) {
          existing++;
          continue;
        }
        await createInvoice(
          tx,
          caller.ctx.orgId,
          now,
          { centerId: k.center_id, learnerName: r.display_name, learnerId: r.id, leadId: null },
          todo,
        );
        created++;
      }
    }
    return { ok: true, created, existing, skippedNoLine: [...skipped] };
  });

  write("/v1/billing/invoices/first", async (tx, caller, d, _p, now) => {
    const lead = await tx
      .selectFrom("lead")
      .select(["id", "learner_name", "course_code", "center_id", "stage", "invoice_no"])
      .where("id", "=", typeof d.leadId === "string" ? d.leadId : "")
      .executeTakeFirst();
    if (!lead) return no("not_found");
    if (!mayAt(caller, lead.center_id)) return no("access_policy");
    if (lead.stage !== "placement")
      return no("invalid_step", "record the placement test in Admissions first");
    if (lead.invoice_no) return no("invalid_step", `already invoiced: ${lead.invoice_no}`);
    const today = centerToday(now.getTime());
    const all = await loadLines(tx);
    const tuition = all
      .filter(
        (l) =>
          l.status === "approved" &&
          l.kind === "tuition" &&
          l.courseCode === lead.course_code &&
          (l.centerId === null || l.centerId === lead.center_id) &&
          l.to >= today,
      )
      .sort((a, b) => a.from.localeCompare(b.from));
    const endsSoon = (l: Line) =>
      l.from <= today && dayNo(l.to) - dayNo(today) < FIRST_INVOICE_MIN_DAYS_LEFT;
    const pick = tuition[0] && endsSoon(tuition[0]) && tuition[1] ? tuition[1] : tuition[0];
    const fee = pick
      ? resolveLines(all, lead.course_code, lead.center_id, pick.year, pick.period)
      : null;
    const centerName = (await centersOf(tx)).get(lead.center_id);
    if (!fee)
      return no(
        "no_fee_line",
        `no approved fee line for ${lead.course_code} at ${centerName} — approve one in Fee plans`,
      );
    const inv = await createInvoice(
      tx,
      caller.ctx.orgId,
      now,
      {
        centerId: lead.center_id,
        learnerName: lead.learner_name,
        learnerId: null,
        leadId: lead.id,
      },
      fee,
    );
    await attachFirstInvoice(tx, caller.ctx.orgId, lead.id, inv.no, now, await nameOf(tx, caller));
    return { ok: true, invoiceNo: inv.no };
  });

  const forWrite = async (tx: TenantTx, caller: Caller, id: string): Promise<Inv | Result> => {
    const inv = (await loadInvoices(tx)).find((i) => i.id === id);
    if (!inv) return no("not_found");
    if (!mayAt(caller, inv.centerId)) return no("access_policy");
    return inv;
  };
  const refused = (x: Inv | Result): x is Result => "ok" in x;

  write("/v1/billing/invoices/:id/payments", async (tx, caller, d, p, now) => {
    const inv = await forWrite(tx, caller, p.id);
    if (refused(inv)) return inv;
    const st = statusOf(inv);
    if (st === "void" || st === "paid")
      return no("invalid_step", `invoice is ${st === "void" ? "void" : "already paid"}`);
    if (!METHODS.includes(d.method as PaymentMethod)) return no("invalid", "unknown method");
    const balance = inv.subtotalVnd - paidOf(inv);
    const amount = d.amountVnd;
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount > balance)
      return no("invalid", `amount must be 1–${fmt(balance)}`);
    const { rows } = await sql<{ n: number }>`select count(*)::int as n from payment`.execute(tx);
    const n = rows[0].n + 1;
    const receiptNo = `RC-${now.toISOString().slice(0, 4)}-${String(n).padStart(4, "0")}`;
    const by = await nameOf(tx, caller);
    await tx
      .insertInto("payment")
      .values({
        org_id: caller.ctx.orgId,
        id: `P-${n}`,
        invoice_id: inv.id,
        amount_vnd: amount,
        method: d.method as PaymentMethod,
        receipt_no: receiptNo,
        at: now,
        recorded_by: by,
      })
      .execute();
    if (inv.leadId && amount === balance)
      await markLeadPaid(tx, caller.ctx.orgId, inv.leadId, inv.subtotalVnd, now, by);
    return { ok: true, receiptNo };
  });

  write("/v1/billing/invoices/:id/void", async (tx, caller, d, p, now) => {
    const inv = await forWrite(tx, caller, p.id);
    if (refused(inv)) return inv;
    if (inv.voidReason) return no("invalid_step", "already void");
    if (inv.payments.length) return no("invalid_step", "payments recorded — cannot void");
    const reason = typeof d.reason === "string" ? d.reason.trim() : "";
    if (reason.length < 3) return no("invalid", "give a reason");
    await tx
      .updateTable("invoice")
      .set({ void_reason: reason.slice(0, 200), voided_at: now })
      .where("id", "=", inv.id)
      .execute();
    if (inv.leadId)
      await attachFirstInvoice(
        tx,
        caller.ctx.orgId,
        inv.leadId,
        null,
        now,
        await nameOf(tx, caller),
      );
    return { ok: true };
  });

  const scoped = async (tx: TenantTx, caller: Caller) => {
    const centers = await centersOf(tx);
    const now = caller.now();
    return {
      centers,
      list: (await loadInvoices(tx))
        .filter((i) => mayAt(caller, i.centerId))
        .map((i) => view(i, centers, now)),
    };
  };

  read("/v1/billing/invoices", async (tx, caller) =>
    (await scoped(tx, caller)).list.sort((a, b) => (a.no < b.no ? 1 : -1)),
  );

  read("/v1/billing/payments", async (tx, caller): Promise<Payment[]> =>
    (await scoped(tx, caller)).list
      .flatMap((i) => i.payments)
      .sort((a, b) =>
        a.at < b.at ? 1 : a.at > b.at ? -1 : b.receiptNo.localeCompare(a.receiptNo),
      ),
  );

  read("/v1/billing/receivables", async (tx, caller): Promise<Receivables> => {
    const vs = (await scoped(tx, caller)).list.filter((v) => v.status !== "void");
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
      const dd = v.daysOverdue;
      if (dd <= 0) row.notDueVnd += v.balanceVnd;
      else if (dd <= 30) row.d1to30Vnd += v.balanceVnd;
      else if (dd <= 60) row.d31to60Vnd += v.balanceVnd;
      else row.over60Vnd += v.balanceVnd;
      byCenter.set(v.centerId, row);
    }
    return {
      outstandingVnd: vs.reduce((t, v) => t + v.balanceVnd, 0),
      overdueVnd: vs.filter((v) => v.daysOverdue > 0).reduce((t, v) => t + v.balanceVnd, 0),
      collectedVnd: vs.reduce((t, v) => t + v.paidVnd, 0),
      creditAppliedVnd: 0,
      byCenter: [...byCenter.values()].sort((a, b) => a.centerName.localeCompare(b.centerName)),
      overdue: vs.filter((v) => v.daysOverdue > 0).sort((a, b) => b.daysOverdue - a.daysOverdue),
    };
  });

  // ── a guardian's (or a learner who pays their own) invoices, read-only ─────────────────────
  app.secured("GET", "/v1/me/billing", async (caller, _req, reply) => {
    const { role, principalId } = caller.ctx;
    const out = await caller.tenant(async (tx): Promise<MyBilling | null> => {
      if (role === "learner") {
        const self = await tx
          .selectFrom("learner")
          .select("pays_own_tuition")
          .where("principal_id", "=", principalId)
          .executeTakeFirst();
        if (!self?.pays_own_tuition) return null; // a minor's tuition is their guardian's
      } else if (role !== "guardian") return null;
      const centers = await centersOf(tx);
      const now = caller.now();
      const mine = (await loadInvoices(tx))
        .filter((i) => i.payerPrincipalId === principalId)
        .map((i) => view(i, centers, now))
        .sort((a, b) => (a.no < b.no ? 1 : -1));
      return {
        invoices: mine,
        outstandingVnd: mine.reduce((t, v) => t + v.balanceVnd, 0),
        walletVnd: 0,
      };
    });
    return out ?? reply.code(403).send({ error: "not_a_payer" });
  });
}
