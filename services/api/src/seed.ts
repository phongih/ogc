/*
 * Synthetic dev / staging data for the Platform (ADR-040 §6: synthetic only). Mirrors the demo's
 * fixtures (same ids and names) so the two runtimes can be compared. Loaded by the OWNER role —
 * reference data is not writable by `ogc_app`.
 *
 * Sessions follow each class's weekly slot in CENTER time (Asia/Ho_Chi_Minh, UTC+7, no DST), like
 * the demo: "A2 Morning — Mon/Wed" meets Mondays and Wednesdays at 09:00. Ids count from `now`:
 * `k1-m1` is the class's latest slot that has started, `k1-m2` the one before; `k1-p1` the next one.
 *
 * CLI: DATABASE_URL_MIGRATE=… node dist/seed.mjs            (refuses if the data is already there)
 *      DATABASE_URL_MIGRATE=… node dist/seed.mjs --reset    (staging: delete the two synthetic
 *        organizations' rows, then seed again — one transaction; the audit log is append-only and
 *        is kept)
 */
import pg from "pg";
import { commissionFor } from "@ogc/contracts";
import { cycleOf } from "./domains/partners.js";
import { seedCourses, seedLumenCourse } from "./seedCourses.js";

export const NOVA = "00000000-0000-4000-8000-000000000001";
export const LUMEN = "00000000-0000-4000-8000-000000000002";
export const D1 = "00000000-0000-4000-8000-000000000c01";
export const THU_DUC = "00000000-0000-4000-8000-000000000c02";
export const A2M = "00000000-0000-4000-8000-0000000000k1";
export const B1E = "00000000-0000-4000-8000-0000000000k2";
export const A2E = "00000000-0000-4000-8000-0000000000k3";
export const TARA = "00000000-0000-4000-8000-00000000t001";
export const BEN = "00000000-0000-4000-8000-00000000t002";
export const MIA = "00000000-0000-4000-8000-00000000t003";
export const L = (n: number) => `00000000-0000-4000-8000-00000000L00${n}`;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const CENTER_OFFSET = 7 * HOUR; // Asia/Ho_Chi_Minh

/**
 * Session id for class `k`: n < 0 counts back from `now` (-1 = latest started slot), n > 0 forward
 * (1 = next slot). E.g. sid("k1", -1) = "k1-m1", sid("k1", 2) = "k1-p2".
 */
export const sid = (k: string, n: number) => `${k}-${n < 0 ? "m" : "p"}${Math.abs(n)}`;

/**
 * The `past` latest slots that have started (newest first) and the `ahead` next ones, for a class
 * meeting on `weekdays` (0 = Sunday) at `hour`:`minute` center time.
 */
export function weeklySlots(
  now: number,
  weekdays: number[],
  hour: number,
  minute: number,
  past: number,
  ahead: number,
): { past: Date[]; ahead: Date[] } {
  const day0 = Math.floor((now + CENTER_OFFSET) / DAY); // today, center calendar
  const all: number[] = [];
  for (let d = -35; d <= 35; d++) {
    const midnight = (day0 + d) * DAY; // center-local midnight, expressed as if UTC
    if (!weekdays.includes(new Date(midnight).getUTCDay())) continue;
    all.push(midnight + hour * HOUR + minute * 60_000 - CENTER_OFFSET);
  }
  return {
    past: all
      .filter((t) => t <= now)
      .slice(-past)
      .reverse()
      .map((t) => new Date(t)),
    ahead: all
      .filter((t) => t > now)
      .slice(0, ahead)
      .map((t) => new Date(t)),
  };
}

/** The two synthetic organizations; `--reset` touches nothing else. */
export const SYNTHETIC_ORGS = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
] as const;

type Stage = "new" | "assigned" | "contacted" | "placement" | "offer" | "enrolled" | "lost";
type LeadSeed = {
  name: string;
  course: string;
  center: string;
  source: "walk_in" | "website" | "event" | "phone";
  channel: "zalo" | "phone" | "email" | "in_person" | null;
  needs: string[];
  created: number; // days ago
  path: [Stage, number][]; // stage changes, days ago
  who?: "sam" | "olivia";
  acts?: [number, "call" | "message" | "meeting" | "note", string][];
  lost?: string;
};
const CENTER_CAU_GIAY = "00000000-0000-4000-8000-000000000c03";
const STAFF = {
  sam: { principal: "iios-principal-staff-1", name: "Sam (Org Staff)" },
  olivia: { principal: "iios-principal-admin-1", name: "Olivia (Org Admin)" },
};
/** The demo's synthetic leads (apps/web/src/lib/adapters/mockAdmissions.ts): same names and paths. */
export const LEAD_SEEDS: LeadSeed[] = [
  {
    name: "Hoa P.",
    course: "ENG-A2",
    center: D1,
    source: "walk_in",
    channel: "zalo",
    needs: ["speaking_confidence"],
    created: 1,
    path: [],
  },
  {
    name: "Quan T.",
    course: "IELTS-B2",
    center: D1,
    source: "website",
    channel: "email",
    needs: ["exam_prep"],
    created: 0,
    path: [],
  },
  {
    name: "Lan H.",
    course: "ENG-B1",
    center: THU_DUC,
    source: "event",
    channel: "phone",
    needs: ["work_english"],
    created: 3,
    path: [["assigned", 3]],
    who: "sam",
  },
  {
    name: "Tuan K.",
    course: "ENG-A2",
    center: D1,
    source: "phone",
    channel: "phone",
    needs: ["school_support"],
    created: 20,
    path: [["assigned", 19]],
    who: "sam",
  },
  {
    name: "Ngoc D.",
    course: "ENG-A2",
    center: D1,
    source: "walk_in",
    channel: "in_person",
    needs: ["young_learner", "speaking_confidence"],
    created: 6,
    path: [
      ["assigned", 6],
      ["contacted", 5],
    ],
    who: "sam",
    acts: [
      [5, "call", "Talked about the A2 timetable"],
      [2, "message", "Sent the trial-lesson times"],
    ],
  },
  {
    name: "Bich L.",
    course: "ENG-B1",
    center: THU_DUC,
    source: "website",
    channel: "zalo",
    needs: ["work_english"],
    created: 12,
    path: [
      ["assigned", 12],
      ["contacted", 11],
    ],
    who: "olivia",
    acts: [[11, "call", "Wants evening classes"]],
  },
  {
    name: "Son V.",
    course: "IELTS-B2",
    center: D1,
    source: "event",
    channel: "email",
    needs: ["exam_prep"],
    created: 9,
    path: [
      ["assigned", 9],
      ["contacted", 8],
      ["placement", 4],
    ],
    who: "olivia",
    acts: [
      [8, "call", "Booked a placement test"],
      [4, "meeting", "Placement test: B1+, aiming for IELTS 6.5"],
    ],
  },
  {
    name: "Yen T.",
    course: "ENG-A2",
    center: D1,
    source: "walk_in",
    channel: "in_person",
    needs: ["travel"],
    created: 15,
    path: [
      ["assigned", 15],
      ["contacted", 14],
      ["placement", 13],
    ],
    who: "sam",
    acts: [
      [14, "call", "Placement booked"],
      [13, "meeting", "Placement test done: A2"],
    ],
  },
  {
    name: "Khanh M.",
    course: "ENG-B1",
    center: THU_DUC,
    source: "phone",
    channel: "phone",
    needs: ["school_support"],
    created: 2,
    path: [
      ["assigned", 2],
      ["contacted", 1],
    ],
    who: "olivia",
    acts: [[1, "call", "Parent asked about class size"]],
  },
  {
    name: "Duc A.",
    course: "ENG-A2",
    center: CENTER_CAU_GIAY,
    source: "website",
    channel: "zalo",
    needs: ["young_learner"],
    created: 25,
    path: [
      ["assigned", 24],
      ["contacted", 23],
    ],
    who: "sam",
    acts: [[23, "message", "No reply yet"]],
  },
  {
    name: "Trang B.",
    course: "ENG-A2",
    center: D1,
    source: "event",
    channel: "zalo",
    needs: ["speaking_confidence"],
    created: 40,
    path: [
      ["assigned", 40],
      ["contacted", 39],
      ["placement", 35],
      ["enrolled", 30],
    ],
    who: "sam",
    acts: [
      [39, "call", "Interested in mornings"],
      [35, "meeting", "Placement test: A2"],
    ],
  },
  {
    name: "Long H.",
    course: "ENG-B1",
    center: THU_DUC,
    source: "walk_in",
    channel: "in_person",
    needs: ["work_english"],
    created: 50,
    path: [
      ["assigned", 50],
      ["contacted", 49],
      ["placement", 47],
      ["enrolled", 44],
    ],
    who: "olivia",
    acts: [[49, "call", "Booked placement"]],
  },
  {
    name: "Nhi C.",
    course: "IELTS-B2",
    center: D1,
    source: "website",
    channel: "email",
    needs: ["exam_prep"],
    created: 30,
    path: [
      ["assigned", 30],
      ["contacted", 28],
      ["lost", 20],
    ],
    who: "olivia",
    acts: [[28, "call", "Comparing with another center"]],
    lost: "Chose another center",
  },
  {
    name: "Vinh S.",
    course: "ENG-A2",
    center: CENTER_CAU_GIAY,
    source: "phone",
    channel: "phone",
    needs: ["young_learner"],
    created: 18,
    path: [
      ["assigned", 18],
      ["lost", 10],
    ],
    who: "sam",
    lost: "Timetable does not fit",
  },
];

/** The school year running at the center (from August): 2026 for "2026-2027". */
export function schoolYearStart(now: number): number {
  const t = new Date(now + 7 * 3_600_000).toISOString();
  return Number(t.slice(5, 7)) >= 8 ? Number(t.slice(0, 4)) : Number(t.slice(0, 4)) - 1;
}

/**
 * The demo's fee plan for the CURRENT school year (so a period is always running) — tuition for
 * every course × term, approved by Olivia; a materials fee for A2 Term 2 waiting for an Org Admin —
 * and Term 1 invoices issued 25/08: paid 10/09, except An P. (part-paid) and Huy D., Vy H. (unpaid).
 */
async function seedBilling(c: pg.Client, now: number): Promise<void> {
  const y = schoolYearStart(now);
  const yr = `${y}-${y + 1}`;
  const terms = [
    ["Term 1", `${y}-09-01`, `${y}-11-30`, `${y}-09-15`],
    ["Term 2", `${y}-12-01`, `${y + 1}-02-28`, `${y}-12-10`],
    ["Term 3", `${y + 1}-03-01`, `${y + 1}-05-31`, `${y + 1}-03-10`],
    ["Summer", `${y + 1}-06-01`, `${y + 1}-08-31`, `${y + 1}-06-10`],
  ];
  const tuition: [string, number][] = [
    ["ENG-A2", 6_900_000],
    ["ENG-B1", 8_400_000],
    ["IELTS-B2", 12_000_000],
  ];
  const line = async (
    id: number,
    course: string,
    kind: string,
    t: string[],
    amount: number,
    approved: boolean,
  ) =>
    c.query(
      `insert into fee_line (org_id, id, year, course_code, center_id, kind, period, from_date, to_date, due_date,
         amount_vnd, status, proposed_by, proposed_by_name, proposed_at, decided_by_name, decided_at)
       values ($1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, $11, 'iios-principal-staff-1', 'Sam (Org Staff)', $12, $13, $14)`,
      [
        NOVA,
        `FL-${id}`,
        yr,
        course,
        kind,
        ...t,
        amount,
        approved ? "approved" : "pending",
        approved ? `${y}-08-01T02:00:00Z` : new Date(now),
        approved ? "Olivia (Org Admin)" : null,
        approved ? `${y}-08-02T02:00:00Z` : null,
      ],
    );
  let n = 0;
  const term1: Record<string, string> = {};
  for (const [course, amount] of tuition)
    for (const t of terms) {
      await line(++n, course, "tuition", t, amount, true);
      if (t[0] === "Term 1") term1[course] = `FL-${n}`;
    }
  await line(++n, "ENG-A2", "materials", terms[1], 450_000, false);

  // Term 1 invoices: one per learner of each class, payer = guardian or a learner who pays.
  const ls = await c.query<{
    learner_id: string;
    name: string;
    center_id: string;
    code: string;
    pays: boolean;
    principal_id: string | null;
    guardian: string | null;
    guardian_name: string | null;
  }>(
    `select l.id as learner_id, l.display_name as name, k.center_id, co.code, l.pays_own_tuition as pays,
            l.principal_id, g.guardian_principal_id as guardian, g.guardian_name
       from roster r join class k on k.id = r.class_id join learner l on l.id = r.learner_id
       join course co on co.id = k.course_id
       left join guardian_link g on g.learner_id = l.id
      order by k.id, l.id`,
  );
  let inv = 0;
  let rc = 0;
  const issued = `${y}-08-25T02:00:00Z`;
  for (const r of ls.rows) {
    const amount = tuition.find(([code]) => code === r.code)![1];
    const id = `I-${++inv}`;
    const payer = r.guardian
      ? [r.guardian, r.guardian_name]
      : r.pays
        ? [r.principal_id, r.name]
        : [null, null];
    await c.query(
      `insert into invoice (org_id, id, no, center_id, learner_name, learner_id, payer_principal_id, payer_name,
         subtotal_vnd, issued_at, due_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        NOVA,
        id,
        `INV-${y}-${String(inv).padStart(4, "0")}`,
        r.center_id,
        r.name,
        r.learner_id,
        ...payer,
        amount,
        issued,
        `${y}-09-15`,
      ],
    );
    await c.query(
      "insert into invoice_line (org_id, invoice_id, fee_line_id, description, amount_vnd) values ($1, $2, $3, $4, $5)",
      [NOVA, id, term1[r.code], `${r.code} · Tuition · Term 1 ${yr}`, amount],
    );
    if (r.name === "Huy D." || r.name === "Vy H.") continue;
    await c.query(
      `insert into payment (org_id, id, invoice_id, amount_vnd, method, receipt_no, at, recorded_by)
       values ($1, $2, $3, $4, 'bank_transfer', $5, $6, 'Sam (Org Staff)')`,
      [
        NOVA,
        `P-${++rc}`,
        id,
        r.name === "An P." ? 3_000_000 : amount,
        `RC-${y}-${String(rc).padStart(4, "0")}`,
        `${y}-09-10T03:00:00Z`,
      ],
    );
  }
}

/**
 * The demo's partner sample (Lotus, Sao Mai with v2 waiting, Hanoi Bridge) and its 15 ledger
 * entries, dated from `now`: Lotus has 3 enrolments this month and one approved entry past its due
 * date; Sao Mai a stale referral and two rejections; last month's paid entries were settled in
 * ST-LOTUS-01 and ST-BRIDGE-01 — sent the day after the last approval in them, paid 8 days later.
 */
async function seedPartners(c: pg.Client, now: number): Promise<void> {
  const D1_ = D1;
  const partners = [
    ["PTN-LOTUS", "Lotus English — Binh Thanh", ["ENG-A2", "ENG-B1"], [D1_, THU_DUC], 82, 15],
    ["PTN-SAOMAI", "Sao Mai IELTS Academy — District 3", ["IELTS-B2", "ENG-B1"], [D1_], 74, 20],
    ["PTN-BRIDGE", "Hanoi Bridge English — Dong Da", ["ENG-A2"], [CENTER_CAU_GIAY], 68, 15],
  ] as const;
  for (const [id, name, courses, near, ret, days] of partners)
    await c.query(
      "insert into partner (org_id, id, name, courses, near_center_ids, retention_pct, settlement_days) values ($1, $2, $3, $4, $5, $6, $7)",
      [NOVA, id, name, courses, near, ret, days],
    );
  type Rule = {
    id: string;
    partner: string;
    version: number;
    status: string;
    cycle: "monthly" | "quarterly";
    mode: "progressive" | "retroactive";
    tiers: { minCount: number; amountVnd: number }[];
    attr: number;
    claw: number;
  };
  const rules: Rule[] = [
    {
      id: "TR-1",
      partner: "PTN-LOTUS",
      version: 1,
      status: "active",
      cycle: "monthly",
      mode: "progressive",
      tiers: [
        { minCount: 1, amountVnd: 1_000_000 },
        { minCount: 4, amountVnd: 2_000_000 },
        { minCount: 8, amountVnd: 3_000_000 },
      ],
      attr: 60,
      claw: 7,
    },
    {
      id: "TR-2",
      partner: "PTN-SAOMAI",
      version: 1,
      status: "active",
      cycle: "quarterly",
      mode: "retroactive",
      tiers: [
        { minCount: 1, amountVnd: 1_500_000 },
        { minCount: 4, amountVnd: 2_500_000 },
      ],
      attr: 30,
      claw: 14,
    },
    {
      id: "TR-3",
      partner: "PTN-SAOMAI",
      version: 2,
      status: "pending",
      cycle: "quarterly",
      mode: "retroactive",
      tiers: [
        { minCount: 1, amountVnd: 1_500_000 },
        { minCount: 4, amountVnd: 2_500_000 },
        { minCount: 8, amountVnd: 3_500_000 },
      ],
      attr: 30,
      claw: 14,
    },
    {
      id: "TR-4",
      partner: "PTN-BRIDGE",
      version: 1,
      status: "active",
      cycle: "monthly",
      mode: "progressive",
      tiers: [
        { minCount: 1, amountVnd: 800_000 },
        { minCount: 5, amountVnd: 1_500_000 },
      ],
      attr: 30,
      claw: 7,
    },
  ];
  for (const r of rules) {
    const pending = r.status === "pending";
    await c.query(
      `insert into partner_rule (org_id, id, partner_id, version, status, cycle, mode, tiers, attribution_window_days,
         clawback_window_days, proposed_by, proposed_by_name, proposed_at, decided_by_name, decided_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'iios-principal-staff-1', 'Sam (Org Staff)', $11, $12, $13)`,
      [
        NOVA,
        r.id,
        r.partner,
        r.version,
        r.status,
        r.cycle,
        r.mode,
        JSON.stringify(r.tiers),
        r.attr,
        r.claw,
        new Date(now - (pending ? 2 : 120) * DAY),
        pending ? null : "Olivia (Org Admin)",
        pending ? null : new Date(now - 119 * DAY),
      ],
    );
  }
  const ruleOf = (pid: string) => rules.find((r) => r.partner === pid && r.status === "active")!;
  const monthStart = cycleOf("monthly", now).start;
  const inMonth = (h: number) => Math.min(now - 3_600_000, monthStart + h * 3_600_000);
  const lastMonth = cycleOf("monthly", monthStart - DAY).start;
  type S = {
    p: string;
    name: string;
    course: string;
    referred: number;
    enrolled?: number;
    status: string;
    approvedAgo?: number;
    batch?: string;
    reason?: string;
  };
  const S: S[] = [
    {
      p: "PTN-LOTUS",
      name: "Quan B.",
      course: "ENG-A2",
      referred: inMonth(10) - 6 * DAY,
      enrolled: inMonth(10),
      status: "enrolled",
    },
    {
      p: "PTN-LOTUS",
      name: "Nhi P.",
      course: "ENG-B1",
      referred: inMonth(30) - 5 * DAY,
      enrolled: inMonth(30),
      status: "enrolled",
    },
    {
      p: "PTN-LOTUS",
      name: "Dat H.",
      course: "ENG-A2",
      referred: inMonth(60) - 4 * DAY,
      enrolled: inMonth(60),
      status: "enrolled",
    },
    {
      p: "PTN-LOTUS",
      name: "Mai L.",
      course: "ENG-B1",
      referred: now - 5 * DAY,
      status: "referred",
    },
    {
      p: "PTN-LOTUS",
      name: "Son K.",
      course: "ENG-A2",
      referred: now - 12 * DAY,
      status: "referred",
    },
    {
      p: "PTN-LOTUS",
      name: "Ha T.",
      course: "ENG-A2",
      referred: lastMonth + 2 * DAY - 9 * DAY,
      enrolled: lastMonth + 2 * DAY,
      status: "paid",
      approvedAgo: 40,
      batch: "ST-LOTUS-01",
    },
    {
      p: "PTN-LOTUS",
      name: "Long V.",
      course: "ENG-B1",
      referred: lastMonth + 4 * DAY - 9 * DAY,
      enrolled: lastMonth + 4 * DAY,
      status: "paid",
      approvedAgo: 40,
      batch: "ST-LOTUS-01",
    },
    {
      p: "PTN-LOTUS",
      name: "Trang N.",
      course: "ENG-A2",
      referred: lastMonth + 6 * DAY - 8 * DAY,
      enrolled: lastMonth + 6 * DAY,
      status: "approved",
      approvedAgo: 30,
    },
    {
      p: "PTN-SAOMAI",
      name: "Khanh D.",
      course: "IELTS-B2",
      referred: now - 26 * DAY,
      enrolled: now - 20 * DAY,
      status: "enrolled",
    },
    {
      p: "PTN-SAOMAI",
      name: "Phuong A.",
      course: "IELTS-B2",
      referred: now - 24 * DAY,
      enrolled: now - 16 * DAY,
      status: "enrolled",
    },
    {
      p: "PTN-SAOMAI",
      name: "Tuan M.",
      course: "ENG-B1",
      referred: now - 25 * DAY,
      status: "referred",
    },
    {
      p: "PTN-SAOMAI",
      name: "Lan C.",
      course: "IELTS-B2",
      referred: now - 22 * DAY,
      status: "rejected",
      reason: "already a learner at the partner",
    },
    {
      p: "PTN-SAOMAI",
      name: "Bich T.",
      course: "IELTS-B2",
      referred: now - 19 * DAY,
      status: "rejected",
      reason: "did not enrol within the window",
    },
    {
      p: "PTN-BRIDGE",
      name: "Hoa G.",
      course: "ENG-A2",
      referred: now - 3 * DAY,
      status: "referred",
    },
    {
      p: "PTN-BRIDGE",
      name: "Vinh Q.",
      course: "ENG-A2",
      referred: lastMonth + 3 * DAY - 7 * DAY,
      enrolled: lastMonth + 3 * DAY,
      status: "paid",
      approvedAgo: 35,
      batch: "ST-BRIDGE-01",
    },
  ];
  const settle = Object.fromEntries(partners.map(([id, , , , , days]) => [id, days]));
  const inBatch = new Map<
    string,
    { partner: string; ids: string[]; approved: number[]; cycle: { key: string; label: string } }
  >();
  for (const [i, s] of S.entries()) {
    const rule = ruleOf(s.p);
    const locked = s.status === "approved" || s.status === "paid";
    let amount: number | null = null;
    let tier: number | null = null;
    if (locked && s.enrolled) {
      // as approval would have locked it: the n-th counted enrolment of its cycle
      const key = cycleOf(rule.cycle, s.enrolled).key;
      const same = S.filter(
        (x) =>
          x.p === s.p &&
          x.enrolled &&
          x.status !== "rejected" &&
          x.status !== "referred" &&
          cycleOf(rule.cycle, x.enrolled).key === key,
      )
        .map((x) => x.enrolled!)
        .sort((a, b) => a - b);
      const c = commissionFor(rule, same.indexOf(s.enrolled) + 1, same.length);
      amount = c.amountVnd;
      tier = c.tierIndex;
    }
    // never approved before the enrolment it approves
    const approvedAt = s.approvedAgo
      ? Math.max(now - s.approvedAgo * DAY, (s.enrolled ?? now) + DAY)
      : null;
    if (s.batch && approvedAt && s.enrolled) {
      const g = inBatch.get(s.batch) ?? {
        partner: s.p,
        ids: [],
        approved: [],
        cycle: cycleOf(rule.cycle, s.enrolled),
      };
      g.ids.push(`CE-${i + 1}`);
      g.approved.push(approvedAt);
      inBatch.set(s.batch, g);
    }
    await c.query(
      `insert into commission_entry (org_id, id, partner_id, lead_id, lead_ref_code, learner_display_name, course_code,
         referred_at, expires_at, enrolled_at, enrolled_by, status, applied_rule_id, locked_amount_vnd, locked_tier_index,
         approved_at, due_date, reject_reason, settled_batch_id, updated_by_name, updated_at)
       values ($1, $2, $3, null, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        NOVA,
        `CE-${i + 1}`,
        s.p,
        `LR-${1001 + i}`,
        s.name,
        s.course,
        new Date(s.referred),
        new Date(s.referred + rule.attr * DAY),
        s.enrolled ? new Date(s.enrolled) : null,
        s.enrolled ? "iios-principal-staff-1" : null,
        s.status,
        s.enrolled ? rule.id : null,
        amount,
        tier,
        approvedAt ? new Date(approvedAt) : null,
        approvedAt ? new Date(approvedAt + settle[s.p] * DAY) : null,
        s.reason ?? null,
        s.batch ?? null,
        locked ? "Olivia (Org Admin)" : "Sam (Org Staff)",
        new Date(now - DAY),
      ],
    );
  }
  for (const [id, g] of inBatch) {
    const sentAt = Math.max(...g.approved) + DAY;
    await c.query(
      `insert into settlement_batch (org_id, id, partner_id, cycle_key, cycle_label, status, created_by, created_by_name,
         created_at, sent_by_name, sent_at, due_date, paid_by_name, paid_at, payment_ref)
       values ($1, $2, $3, $4, $5, 'paid', 'iios-principal-staff-1', 'Sam (Org Staff)', $6, 'Olivia (Org Admin)', $7, $8,
         'Sam (Org Staff)', $9, $10)`,
      [
        NOVA,
        id,
        g.partner,
        g.cycle.key,
        g.cycle.label,
        new Date(sentAt - DAY),
        new Date(sentAt),
        new Date(sentAt + settle[g.partner] * DAY),
        new Date(Math.min(now - DAY, sentAt + 8 * DAY)),
        `BANK-${id.slice(3)}`,
      ],
    );
    for (const e of g.ids)
      await c.query(
        "insert into settlement_batch_entry (org_id, batch_id, entry_id) values ($1, $2, $3)",
        [NOVA, id, e],
      );
  }
}

async function seedLeads(c: pg.Client, now: number): Promise<void> {
  const ago = (d: number, h = 0) => new Date(now - d * DAY - h * 3_600_000);
  for (const [i, s] of LEAD_SEEDS.entries()) {
    const id = `ADM-${i + 1}`;
    const who = s.who ? STAFF[s.who] : null;
    const stage = s.path.length ? s.path[s.path.length - 1][0] : "new";
    await c.query(
      `insert into lead (org_id, id, learner_name, course_code, center_id, source, channel, needs, stage,
         assigned_to, lost_reason, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        NOVA,
        id,
        s.name,
        s.course,
        s.center,
        s.source,
        s.channel,
        s.needs,
        stage,
        who?.principal ?? null,
        s.lost ?? null,
        ago(s.created),
      ],
    );
    const history: [Stage, Date, string][] = [
      ["new", ago(s.created), "Website form"],
      ...s.path.map(([st, d]) => [st, ago(d, 1), (who ?? STAFF.sam).name] as [Stage, Date, string]),
    ];
    for (const [n, [st, at, by]] of history.entries())
      await c.query(
        "insert into lead_history (org_id, lead_id, seq, stage, at, by_name) values ($1, $2, $3, $4, $5, $6)",
        [NOVA, id, n + 1, st, at, by],
      );
    for (const [n, [d, kind, text]] of (s.acts ?? []).entries())
      await c.query(
        "insert into lead_activity (org_id, lead_id, seq, kind, text, at, by_name) values ($1, $2, $3, $4, $5, $6, $7)",
        [NOVA, id, n + 1, kind, text, ago(d), (who ?? STAFF.sam).name],
      );
  }
}

export async function seedDev(
  ownerUrl: string,
  now = Date.now(),
  opts: { reset?: boolean } = {},
): Promise<void> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query("begin");
    const scope = (org: string) => c.query("select set_config('app.org_id', $1, true)", [org]);

    if (opts.reset)
      for (const org of SYNTHETIC_ORGS) {
        await scope(org);
        // children first (composite FKs); sessions point at each other via replaces/replaced_by
        await c.query("delete from course_review");
        await c.query("delete from course_version");
        await c.query("delete from authored_course");
        await c.query("delete from partner_signal_mark");
        await c.query("delete from partner_activity");
        await c.query("delete from settlement_batch_entry");
        await c.query("delete from settlement_batch");
        await c.query("delete from commission_entry");
        await c.query("delete from partner_rule");
        await c.query("delete from partner");
        await c.query("delete from payment");
        await c.query("delete from invoice_line");
        await c.query("delete from invoice");
        await c.query("delete from fee_line");
        await c.query("delete from lead_activity");
        await c.query("delete from lead_history");
        await c.query("delete from lead");
        await c.query("delete from admissions_settings");
        await c.query("delete from staff_member");
        await c.query("delete from teacher_target");
        await c.query("delete from workforce_settings");
        await c.query("delete from makeup_booking");
        await c.query("delete from makeup_selfstudy");
        await c.query("delete from attendance");
        await c.query("update session set replaced_by = null, replaces = null");
        for (const t of [
          "session",
          "roster",
          "class",
          "course",
          "guardian_link",
          "learner",
          "teacher",
          "center",
        ])
          await c.query(`delete from ${t}`);
        await c.query("delete from idempotency_key");
      }

    // ── Nova Learning ──────────────────────────────────────────────────────────────────────
    await scope(NOVA);
    const has = await c.query("select 1 from class limit 1");
    if (has.rowCount) throw new Error("seed: this database already has data");
    await c.query(
      `insert into center (org_id, id, name) values
        ($1, $2, 'Nova English — District 1'), ($1, $3, 'Nova English — Thu Duc'),
        ($1, '00000000-0000-4000-8000-000000000c03', 'Nova Juniors — Cau Giay')`,
      [NOVA, D1, THU_DUC],
    );
    await c.query(
      `insert into teacher (org_id, id, principal_id, name) values
        ($1, $2, 'iios-principal-teacher-1', 'Tara'), ($1, $3, 'iios-principal-teacher-2', 'Ben'),
        ($1, $4, null, 'Mia'), ($1, '00000000-0000-4000-8000-00000000t004', null, 'Khang')`,
      [NOVA, TARA, BEN, MIA],
    );
    const names = ["Linh N.", "Minh T.", "An P.", "Huy D.", "Thao V.", "Khoa L.", "Vy H."];
    // Linh and Minh sign in (IIOS principals, as in the demo); the others do not.
    const principals: Record<number, string> = {
      1: "iios-principal-learner-1",
      2: "iios-principal-learner-2",
    };
    for (const [i, n] of names.entries())
      await c.query(
        "insert into learner (org_id, id, principal_id, display_name, pays_own_tuition) values ($1, $2, $3, $4, $5)",
        [NOVA, L(i + 1), principals[i + 1] ?? null, n, i + 1 === 2], // Minh is an adult who pays
      );
    // Mai (guardian) is linked to Linh — synthetic, pre-established (no link-creation path).
    await c.query(
      "insert into guardian_link (org_id, guardian_principal_id, learner_id, guardian_name) values ($1, 'iios-principal-guardian-1', $2, 'Mai (Guardian)')",
      [NOVA, L(1)],
    );
    await c.query(
      `insert into class (org_id, id, center_id, name, teacher_id, course_id) values
        ($1, $2, $5, 'A2 Morning — Mon/Wed', $7, 'course-a2'), ($1, $3, $6, 'B1 Evening — Tue/Thu', $7, 'course-b1'),
        ($1, $4, $5, 'A2 Evening — Tue/Thu', $8, 'course-a2')`,
      [NOVA, A2M, B1E, A2E, D1, THU_DUC, TARA, BEN],
    );
    // Workforce targets (demo spread): Tara over, Ben meets, Mia and Khang have room.
    for (const [teacher, employment, hours] of [
      [TARA, "part_time", 2.5],
      [BEN, "part_time", 4],
      [MIA, "part_time", 4.5],
      ["00000000-0000-4000-8000-00000000t004", "full_time", 20],
    ] as const)
      await c.query(
        "insert into teacher_target (org_id, teacher_id, employment, target_hours, updated_by) values ($1, $2, $3, $4, 'seed')",
        [NOVA, teacher, employment, hours],
      );
    const rosters: [string, number[]][] = [
      [A2M, [1, 2, 3]],
      [B1E, [4, 5]],
      [A2E, [6, 7]],
    ];
    for (const [cls, ls] of rosters)
      for (const l of ls)
        await c.query("insert into roster (org_id, class_id, learner_id) values ($1, $2, $3)", [
          NOVA,
          cls,
          L(l),
        ]);
    // Weekly slots in center time. A2 Morning Mon/Wed 09:00; both evening classes Tue/Thu 18:00,
    // so Ben (A2 Evening) is busy whenever Tara's B1 Evening meets.
    const morning = weeklySlots(now, [1, 3], 9, 0, 3, 2);
    const evening = weeklySlots(now, [2, 4], 18, 0, 1, 2);
    const sessions: [string, string, Date[], Date[], string[]][] = [
      [
        "k1",
        A2M,
        morning.past,
        morning.ahead,
        ["A2 — Unit 4", "A2 — Unit 5", "A2 — Unit 6", "A2 — Unit 7", "A2 — Unit 8"],
      ],
      ["k2", B1E, evening.past, evening.ahead, ["B1 — Unit 2", "B1 — Unit 3", "B1 — Unit 4"]],
      ["k3", A2E, evening.past, evening.ahead, ["A2 — Unit 4", "A2 — Unit 5", "A2 — Unit 6"]],
    ];
    for (const [k, cls, past, ahead, titles] of sessions) {
      // oldest first: m<past>…m1, then p1…p<ahead>
      const rows: [string, Date][] = [
        ...past.map((d, i) => [sid(k, -(i + 1)), d] as [string, Date]).reverse(),
        ...ahead.map((d, i) => [sid(k, i + 1), d] as [string, Date]),
      ];
      for (const [i, [id, d]] of rows.entries())
        await c.query(
          "insert into session (org_id, id, class_id, title, at) values ($1, $2, $3, $4, $5)",
          [NOVA, id, cls, titles[i], d],
        );
    }
    const marks: [string, number, string][] = [
      [sid("k1", -3), 1, "present"],
      [sid("k1", -3), 2, "present"],
      [sid("k1", -3), 3, "present"],
      [sid("k1", -2), 1, "present"],
      [sid("k1", -2), 2, "late"],
      [sid("k1", -2), 3, "absent"],
      [sid("k2", -1), 4, "absent"],
      [sid("k2", -1), 5, "present"],
      [sid("k3", -1), 6, "present"],
      [sid("k3", -1), 7, "present"],
    ];
    for (const [s, l, m] of marks)
      await c.query(
        "insert into attendance (org_id, session_id, learner_id, mark, marked_by) values ($1, $2, $3, $4, 'seed')",
        [NOVA, s, L(l), m],
      );

    // Admissions: the course catalog, the staff leads go to, and the demo's 14 synthetic leads
    // (dated relative to now, so the dashboard always has fresh and stale ones).
    await c.query(
      `insert into course (org_id, id, code, name) values
        ($1, 'course-a2', 'ENG-A2', 'Everyday English A2'),
        ($1, 'course-b1', 'ENG-B1', 'Conversational English B1'),
        ($1, 'course-ielts', 'IELTS-B2', 'IELTS Foundation B2')`,
      [NOVA],
    );
    await c.query(
      `insert into staff_member (org_id, principal_id, display_name, role) values
        ($1, 'iios-principal-admin-1', 'Olivia (Org Admin)', 'admin'),
        ($1, 'iios-principal-staff-1', 'Sam (Org Staff)', 'staff')`,
      [NOVA],
    );
    await seedLeads(c, now);
    await seedBilling(c, now);
    await seedPartners(c, now);
    await seedCourses(c, now, { tara: TARA, ben: BEN });

    // ── Lumen Edu (a second tenant, for isolation) ────────────────────────────────────────
    await scope(LUMEN);
    await c.query(
      "insert into center (org_id, id, name) values ($1, '00000000-0000-4000-8000-000000000c04', 'Lumen Academy — Hai Chau')",
      [LUMEN],
    );
    await c.query(
      "insert into teacher (org_id, id, principal_id, name) values ($1, 'lumen-t1', null, 'Lan')",
      [LUMEN],
    );
    await c.query(
      "insert into staff_member (org_id, principal_id, display_name, role) values ($1, 'iios-principal-staff-org2', 'Staff (Lumen)', 'staff')",
      [LUMEN],
    );
    await seedLumenCourse(c, now);
    await c.query(
      "insert into learner (org_id, id, display_name) values ($1, '00000000-0000-4000-8000-0000000Lo201', 'Learner (Lumen)')",
      [LUMEN],
    );
    await c.query(
      "insert into class (org_id, id, center_id, name, teacher_id) values ($1, 'lumen-k1', '00000000-0000-4000-8000-000000000c04', 'Starter — Sat', 'lumen-t1')",
      [LUMEN],
    );
    await c.query(
      "insert into roster (org_id, class_id, learner_id) values ($1, 'lumen-k1', '00000000-0000-4000-8000-0000000Lo201')",
      [LUMEN],
    );
    await c.query(
      "insert into session (org_id, id, class_id, title, at) values ($1, 'lumen-s1', 'lumen-k1', 'Starter — Unit 1', $2)",
      [LUMEN, weeklySlots(now, [6], 9, 0, 0, 1).ahead[0]],
    );
    await c.query("commit");
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    await c.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_MIGRATE;
  if (!url) throw new Error("seed: DATABASE_URL_MIGRATE is required (the owner role)");
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--reset"))
    throw new Error(`seed: unknown argument ${args.join(" ")}`);
  const reset = args.includes("--reset");
  await seedDev(url, Date.now(), { reset });
  console.log(
    `seed: synthetic dev data ${reset ? "reset and reloaded" : "loaded"} (Nova Learning, Lumen Edu)`,
  );
}
