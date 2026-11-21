import { z } from "zod";

/*
 * P2 · Center setup wizard — ADDITIVE, SYNTHETIC, mock adapter only.
 *
 * Owner decisions (21/11):
 *  - the wizard opens a new CENTER (branch) inside an EXISTING organization. The organization is
 *    the tenant root and comes from the EduOS / IIOS side — OGC does not create tenants;
 *  - "staff" = assign EXISTING teachers to classes. No accounts, no access grants (IIOS / G2-C);
 *  - fees are an OPTIONAL, mock-only step: a price list, nothing is charged or invoiced.
 * Opening a center creates its classes and their first sessions in the live schedule, so
 * attendance, make-ups and every role's view work from day one.
 */

export const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const SetupRoom = z.object({ name: z.string(), capacity: z.number().int() });
export type SetupRoom = z.infer<typeof SetupRoom>;

export const SetupClass = z.object({
  name: z.string(),
  courseId: z.string(),
  room: z.string(), // a room name from this draft
  weekdays: z.array(z.number().int().min(0).max(6)), // 0 = Sun … 6 = Sat, center time
  time: z.string(), // "HH:MM", center time
  durationMin: z.number().int(),
  teacherId: z.string(),
});
export type SetupClass = z.infer<typeof SetupClass>;

export const SetupFee = z.object({
  courseId: z.string(),
  amountVnd: z.number().int(),
  per: z.enum(["course", "month"]),
});
export type SetupFee = z.infer<typeof SetupFee>;

export const CenterSetupDraft = z.object({
  brandId: z.string(),
  name: z.string(),
  code: z.string(),
  city: z.string(),
  addressLine: z.string(),
  courseIds: z.array(z.string()),
  rooms: z.array(SetupRoom),
  openDays: z.array(z.number().int().min(0).max(6)),
  openFrom: z.string(),
  openTo: z.string(),
  classes: z.array(SetupClass),
  fees: z.array(SetupFee), // optional step — may stay empty
});
export type CenterSetupDraft = z.infer<typeof CenterSetupDraft>;

export const emptyCenterDraft = (): CenterSetupDraft => ({
  brandId: "",
  name: "",
  code: "",
  city: "",
  addressLine: "",
  courseIds: [],
  rooms: [],
  openDays: [1, 2, 3, 4, 5, 6],
  openFrom: "08:00",
  openTo: "21:00",
  classes: [],
  fees: [],
});

export interface SetupCheck {
  key: "info" | "courses" | "rooms" | "days" | "classes";
  label: string;
  ok: boolean;
}

const mins = (t: string) =>
  Hhmm.safeParse(t).success ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN;
export const CENTER_CODE = /^[A-Z0-9][A-Z0-9-]{1,11}$/;

/** Problems with one class row, in plain words (empty = fine). */
export function classIssues(d: CenterSetupDraft, c: SetupClass): string[] {
  const out: string[] = [];
  if (!c.name.trim()) out.push("needs a name");
  if (!d.courseIds.includes(c.courseId)) out.push("course is not one of this center's courses");
  const room = d.rooms.find((r) => r.name === c.room);
  if (!room) out.push("needs a room");
  if (c.weekdays.length === 0) out.push("needs at least one weekday");
  if (c.weekdays.some((w) => !d.openDays.includes(w)))
    out.push("meets on a day the center is closed");
  const start = mins(c.time);
  if (Number.isNaN(start)) out.push("needs a start time");
  else if (start < mins(d.openFrom) || start + c.durationMin > mins(d.openTo))
    out.push("is outside opening hours");
  if (!(c.durationMin >= 30 && c.durationMin <= 240)) out.push("lasts 30–240 minutes");
  if (!c.teacherId) out.push("needs a teacher");
  return out;
}

/** The required checklist (same rules in the UI and the adapter). Fees are optional. */
export function centerSetupChecklist(
  d: CenterSetupDraft,
  takenCodes: readonly string[] = [],
): SetupCheck[] {
  const code = d.code.trim().toUpperCase();
  return [
    {
      key: "info",
      label: "Name, code and brand",
      ok: !!d.name.trim() && !!d.brandId && CENTER_CODE.test(code) && !takenCodes.includes(code),
    },
    { key: "courses", label: "At least one course", ok: d.courseIds.length > 0 },
    {
      key: "rooms",
      label: "At least one room",
      ok:
        d.rooms.length > 0 &&
        d.rooms.every((r) => r.name.trim() && r.capacity >= 1 && r.capacity <= 60) &&
        new Set(d.rooms.map((r) => r.name.trim())).size === d.rooms.length,
    },
    {
      key: "days",
      label: "Opening days and hours",
      ok: d.openDays.length > 0 && mins(d.openFrom) < mins(d.openTo),
    },
    {
      key: "classes",
      label: "At least one class with a teacher and a weekly slot",
      ok: d.classes.length > 0 && d.classes.every((c) => classIssues(d, c).length === 0),
    },
  ];
}

export const feeIssues = (f: SetupFee): string[] =>
  f.amountVnd > 0 && f.amountVnd <= 200_000_000
    ? []
    : ["amount must be between 1 and 200,000,000 VND"];

export const SetupContext = z.object({
  orgId: z.string(),
  orgName: z.string(),
  brands: z.array(z.object({ id: z.string(), name: z.string() })),
  courses: z.array(
    z.object({ id: z.string(), code: z.string(), title: z.string(), level: z.string() }),
  ),
  teachers: z.array(z.object({ id: z.string(), name: z.string() })),
  takenCodes: z.array(z.string()),
});
export type SetupContext = z.infer<typeof SetupContext>;

export const CenterSetupResult = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    centerId: z.string(),
    classIds: z.array(z.string()),
    sessionsCreated: z.number().int(),
  }),
  z.object({
    ok: z.literal(false),
    reason: z.enum(["not_staff", "incomplete", "invalid_fee"]),
    failed: z.array(z.string()), // checklist keys / fee course ids that failed
  }),
]);
export type CenterSetupResult = z.infer<typeof CenterSetupResult>;

export interface CenterSetupPort {
  // Staff only, own organization only (fail-closed: null / not_staff).
  getSetupContext(viewerPersonaId: string): Promise<SetupContext | null>;
  createCenter(viewerPersonaId: string, draft: CenterSetupDraft): Promise<CenterSetupResult>;
  getFees(
    viewerPersonaId: string,
    centerId: string,
  ): Promise<(SetupFee & { courseCode: string })[] | null>;
}
