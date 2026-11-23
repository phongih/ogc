// Synthetic seed (ADR-040 §6): sessions fall on the weekdays and time in each class's name, in
// center time, whatever "now" is; `--reset` reloads the two synthetic organizations only.
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { A2M, L, NOVA, seedDev, sid, weeklySlots } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const HOUR = 3_600_000;
const center = (d: Date) => new Date(d.getTime() + 7 * HOUR); // read with getUTC* = center time
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const label = (d: Date) => `${DOW[center(d).getUTCDay()]} ${center(d).toISOString().slice(11, 16)}`;

// Every 5 h over two weeks from a Sunday 23:30 center time: crosses every weekday, midnight in
// both calendars and the class start times themselves.
const NOWS = Array.from(
  { length: 68 },
  (_, i) => Date.parse("2026-11-22T16:30:00Z") + i * 5 * HOUR,
).concat([
  Date.parse("2026-11-23T02:00:00Z"), // Mon 09:00 exactly (a Mon/Wed slot starts now)
  Date.parse("2026-11-23T01:59:59Z"), // Mon 08:59:59
  Date.parse("2026-11-24T11:00:00Z"), // Tue 18:00 exactly
]);

describe("weeklySlots (center time)", () => {
  it("Mon/Wed 09:00 and Tue/Thu 18:00 land on those days and times for any now", () => {
    for (const now of NOWS) {
      const m = weeklySlots(now, [1, 3], 9, 0, 3, 2);
      const e = weeklySlots(now, [2, 4], 18, 0, 1, 2);
      for (const d of [...m.past, ...m.ahead]) expect(label(d)).toMatch(/^(Mon|Wed) 09:00$/);
      for (const d of [...e.past, ...e.ahead]) expect(label(d)).toMatch(/^(Tue|Thu) 18:00$/);
      expect(m.past).toHaveLength(3);
      expect(m.ahead).toHaveLength(2);
      // past = started (newest first), ahead = not yet started (soonest first), no gap between
      expect(m.past.every((d) => d.getTime() <= now)).toBe(true);
      expect(m.ahead.every((d) => d.getTime() > now)).toBe(true);
      const all = [...m.past]
        .reverse()
        .concat(m.ahead)
        .map((d) => d.getTime());
      expect(all).toEqual([...all].sort((a, b) => a - b));
      for (let i = 1; i < all.length; i++)
        expect(all[i] - all[i - 1]).toBeLessThanOrEqual(5 * 24 * HOUR);
    }
  });

  it("a slot that starts exactly now counts as started", () => {
    const now = Date.parse("2026-11-23T02:00:00Z"); // Mon 09:00
    expect(weeklySlots(now, [1, 3], 9, 0, 1, 1).past[0].getTime()).toBe(now);
    expect(label(weeklySlots(now - 1000, [1, 3], 9, 0, 1, 1).ahead[0])).toBe("Mon 09:00");
  });
});

describe.skipIf(!hasPg)("seedDev on PostgreSQL", () => {
  let t: TestDb | undefined;
  afterEach(async () => {
    await t?.drop();
    t = undefined;
  });

  const rows = async (sql: string, org = NOVA, args: unknown[] = []) => {
    const c = new pg.Client({ connectionString: t!.ownerUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.org_id', $1, true)", [org]);
      const r = await c.query(sql, args);
      await c.query("commit");
      return r.rows;
    } finally {
      await c.end();
    }
  };

  it("every Nova session is on its class's weekdays and time (Sunday-night seed)", async () => {
    t = await freshDb();
    const now = Date.parse("2026-11-22T16:30:00Z"); // Sun 23:30 center time
    await seedDev(t.ownerUrl, now);
    const got = await rows(
      `select c.name, s.id,
              to_char(s.at at time zone 'Asia/Ho_Chi_Minh', 'Dy HH24:MI') as slot
         from session s join class c on c.org_id = s.org_id and c.id = s.class_id order by s.at`,
    );
    expect(got.length).toBe(11);
    for (const r of got) {
      const [days, time] = r.name.includes("Morning") ? ["Mon|Wed", "09:00"] : ["Tue|Thu", "18:00"];
      expect(`${r.slot}`).toMatch(new RegExp(`^(${days}) ${time}$`));
    }
    // to-mark is the latest started A2 Morning slot (Wed 18/11 09:00 seen from Sunday night)
    const m1 = await rows(
      "select to_char(at at time zone 'Asia/Ho_Chi_Minh', 'Dy DD/MM HH24:MI') as v from session where id = $1",
      NOVA,
      [sid("k1", -1)],
    );
    expect(m1[0].v).toBe("Wed 18/11 09:00");
  });

  it("--reset reloads Nova + Lumen atomically, keeps the audit log, leaves other orgs alone", async () => {
    t = await freshDb();
    const now = Date.parse("2026-11-23T05:00:00Z");
    await seedDev(t.ownerUrl, now);
    await expect(seedDev(t.ownerUrl, now)).rejects.toThrow(/already has data/);
    // staging drift: a cancelled session with a replacement, a new mark, an idempotency key,
    // an audit row; plus a third organization that must survive the reset
    const OTHER = "00000000-0000-4000-8000-000000000009";
    await rows(
      `insert into session (org_id, id, class_id, title, at, replaces)
         values ($1, 'x-repl', $2, 'Replacement', now() + interval '9 days', $3)`,
      NOVA,
      [NOVA, A2M, sid("k1", 1)],
    );
    await rows(
      "update session set state = 'cancelled', replaced_by = 'x-repl' where id = $1",
      NOVA,
      [sid("k1", 1)],
    );
    await rows(
      "insert into attendance (org_id, session_id, learner_id, mark, marked_by) values ($1, $2, $3, 'absent', 'drift')",
      NOVA,
      [NOVA, sid("k1", -1), L(1)],
    );
    await rows(
      `insert into idempotency_key (org_id, key, principal_id, route, request_hash, status_code, response)
         values ($1, 'drift-key-123', 'p', 'r', 'h', 200, '{}')`,
      NOVA,
      [NOVA],
    );
    await rows(
      `insert into audit_event (org_id, principal_id, request_id, action, resource, outcome)
         values ($1, 'p', 'req', 'schedule:manage', '{}', 'allowed')`,
      NOVA,
      [NOVA],
    );
    await rows(
      "insert into center (org_id, id, name) values ($1, 'other-c', 'Other center')",
      OTHER,
      [OTHER],
    );
    const auditBefore = (await rows("select count(*)::int as n from audit_event"))[0].n;
    expect(auditBefore).toBe(1);

    await seedDev(t.ownerUrl, now, { reset: true });

    expect((await rows("select count(*)::int as n from session"))[0].n).toBe(11);
    expect((await rows("select count(*)::int as n from session where id = 'x-repl'"))[0].n).toBe(0);
    expect(
      (await rows("select state from session where id = $1", NOVA, [sid("k1", 1)]))[0].state,
    ).toBe("scheduled");
    expect(
      (await rows("select count(*)::int as n from attendance where marked_by = 'drift'"))[0].n,
    ).toBe(0);
    expect((await rows("select count(*)::int as n from attendance"))[0].n).toBe(10);
    expect((await rows("select count(*)::int as n from idempotency_key"))[0].n).toBe(0);
    expect((await rows("select count(*)::int as n from audit_event"))[0].n).toBe(auditBefore);
    expect((await rows("select count(*)::int as n from center", OTHER))[0].n).toBe(1);
    expect(
      (
        await rows("select count(*)::int as n from session", "00000000-0000-4000-8000-000000000002")
      )[0].n,
    ).toBe(1);
  });
});
