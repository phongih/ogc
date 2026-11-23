/*
 * Synthetic dev / staging data for the Platform (ADR-040 §6: synthetic only). Mirrors the demo's
 * fixtures (same ids and names) so the two runtimes can be compared. Loaded by the OWNER role —
 * reference data is not writable by `ogc_app`. Sessions are placed relative to `now`.
 *
 * CLI: DATABASE_URL_MIGRATE=… node dist/seed.mjs   (refuses if the organization already has data)
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

/** Session id for class `k` on day offset `d` (e.g. sid("k1", -6) = "k1-m6"). */
export const sid = (k: string, d: number) => `${k}-${d < 0 ? "m" : "p"}${Math.abs(d)}`;

export async function seedDev(ownerUrl: string, now = Date.now()): Promise<void> {
  const day0 = Math.floor(now / DAY) * DAY; // UTC midnight of today
  const at = (d: number, utcHour: number) => new Date(day0 + d * DAY + utcHour * 3600_000);
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query("begin");
    const scope = (org: string) => c.query("select set_config('app.org_id', $1, true)", [org]);

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
    for (const [i, n] of names.entries())
      await c.query("insert into learner (org_id, id, display_name) values ($1, $2, $3)", [
        NOVA,
        L(i + 1),
        n,
      ]);
    await c.query(
      `insert into class (org_id, id, center_id, name, teacher_id) values
        ($1, $2, $5, 'A2 Morning — Mon/Wed', $7), ($1, $3, $6, 'B1 Evening — Tue/Thu', $7),
        ($1, $4, $5, 'A2 Evening — Tue/Thu', $8)`,
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
    // A2 Morning 09:00 center time (02:00Z); both evening classes 18:00 (11:00Z) on the same days,
    // so Ben is busy whenever B1 Evening meets.
    const sessions: [string, string, number, number, string][] = [
      ["k1", A2M, -6, 2, "A2 — Unit 4"],
      ["k1", A2M, -4, 2, "A2 — Unit 5"],
      ["k1", A2M, -1, 2, "A2 — Unit 6"],
      ["k1", A2M, 1, 2, "A2 — Unit 7"],
      ["k1", A2M, 3, 2, "A2 — Unit 8"],
      ["k2", B1E, -5, 11, "B1 — Unit 2"],
      ["k2", B1E, 2, 11, "B1 — Unit 3"],
      ["k2", B1E, 4, 11, "B1 — Unit 4"],
      ["k3", A2E, -5, 11, "A2 — Unit 4"],
      ["k3", A2E, 2, 11, "A2 — Unit 5"],
      ["k3", A2E, 4, 11, "A2 — Unit 6"],
    ];
    for (const [k, cls, d, h, title] of sessions)
      await c.query(
        "insert into session (org_id, id, class_id, title, at) values ($1, $2, $3, $4, $5)",
        [NOVA, sid(k, d), cls, title, at(d, h)],
      );
    const marks: [string, number, string][] = [
      [sid("k1", -6), 1, "present"],
      [sid("k1", -6), 2, "present"],
      [sid("k1", -6), 3, "present"],
      [sid("k1", -4), 1, "present"],
      [sid("k1", -4), 2, "late"],
      [sid("k1", -4), 3, "absent"],
      [sid("k2", -5), 4, "absent"],
      [sid("k2", -5), 5, "present"],
      [sid("k3", -5), 6, "present"],
      [sid("k3", -5), 7, "present"],
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
      [LUMEN, at(1, 2)],
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
  await seedDev(url);
  console.log("seed: synthetic dev data loaded (Nova Learning, Lumen Edu)");
}
