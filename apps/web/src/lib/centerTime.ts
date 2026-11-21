/*
 * Center time. The synthetic centers are in Vietnam (Asia/Ho_Chi_Minh, UTC+7, no DST).
 * Class schedules are defined and displayed in CENTER time, so "B1 Evening — Tue/Thu 18:00"
 * reads as Tuesday/Thursday 18:00 for everyone — not as "Wed 01:00" (seen 21/11 when slots
 * were UTC and the teacher page used the viewer's locale/timezone).
 */
export const CENTER_TZ = "Asia/Ho_Chi_Minh";
export const CENTER_UTC_OFFSET_MIN = 7 * 60;

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CENTER_TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: CENTER_TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** "Mon, 23/11/2026, 09:00" in center time. */
export function formatCenterDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

/** "Mon, 23/11/2026" in center time. */
export function formatCenterDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

/**
 * A `<input type="datetime-local">` value ("2026-11-25T09:00") read as CENTER time → ISO instant.
 * Null if malformed. Staff schedule in the center's clock, whatever their own device says.
 */
export function centerLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi) - CENTER_UTC_OFFSET_MIN * 60_000;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** ISO instant → "2026-11-25T09:00" in center time (for a datetime-local input). */
export function isoToCenterLocal(iso: string): string {
  return new Date(Date.parse(iso) + CENTER_UTC_OFFSET_MIN * 60_000).toISOString().slice(0, 16);
}
