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
        await c.query("delete from makeup_booking");
        await c.query("delete from makeup_selfstudy");
        await c.query("delete from attendance");
        await c.query("update session set replaced_by = null, replaces = null");
        for (const t of [
          "session",
          "roster",
          "class",
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
        "insert into learner (org_id, id, principal_id, display_name) values ($1, $2, $3, $4)",
        [NOVA, L(i + 1), principals[i + 1] ?? null, n],
      );
    // Mai (guardian) is linked to Linh — synthetic, pre-established (no link-creation path).
    await c.query(
      "insert into guardian_link (org_id, guardian_principal_id, learner_id) values ($1, 'iios-principal-guardian-1', $2)",
      [NOVA, L(1)],
    );
    await c.query(
      `insert into class (org_id, id, center_id, name, teacher_id, course_id) values
        ($1, $2, $5, 'A2 Morning — Mon/Wed', $7, 'course-a2'), ($1, $3, $6, 'B1 Evening — Tue/Thu', $7, 'course-b1'),
        ($1, $4, $5, 'A2 Evening — Tue/Thu', $8, 'course-a2')`,
      [NOVA, A2M, B1E, A2E, D1, THU_DUC, TARA, BEN],
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
