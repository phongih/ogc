import type { IiosGrantedContext } from "@ogc/contracts";
import { refill, registerPersistent } from "./persist";
import type {
  CenterSetupDraft,
  CenterSetupPort,
  CenterSetupResult,
  SetupContext,
  SetupFee,
} from "@ogc/contracts";
import { centerSetupChecklist, feeIssues } from "@ogc/contracts";
import { brands, centerDetails, centers, organizations } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { teachers } from "../../fixtures/personas";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { nextWeeklySlot } from "../../fixtures/demoClock";
import { sessionStore } from "./sessionStore";
import { findClashes } from "./clashes";
import { withFault } from "./faults";
import { staffOrgOf } from "./viewer";
import { allows } from "./accessPolicy";

/*
 * P2 · Center setup wizard — MOCK adapter. NON-PRODUCTION, synthetic, browser memory.
 * Staff open a CENTER inside their own organization (the tenant root is not created here).
 * Opening writes the center, its classes (with the chosen existing teachers) and the first
 * FIRST_WEEKS weeks of sessions into the live schedule. Fees are a mock price list only.
 */

const latency = <T>(v: T, ms = 80): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
export const FIRST_WEEKS = 4;
const DAY_LETTERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Codes of the seeded centers (synthetic). New centers add theirs.
const SEED_CODES: Record<string, string> = {
  [centers[0].id]: "NV-D1",
  [centers[1].id]: "NV-TD",
  [centers[2].id]: "NJ-CG",
  [centers[3].id]: "LM-HC",
};
const codes: Record<string, string> = { ...SEED_CODES };
const fees = new Map<string, SetupFee[]>();
let seq = 0;
sessionStore.onReset(() => {
  for (const k of Object.keys(codes)) if (!(k in SEED_CODES)) delete codes[k];
  fees.clear();
  seq = 0;
});

const staffOrg = staffOrgOf;
// Access policy (narrows only): may this staff member set up centers?
const maySetUp = (viewer: IiosGrantedContext) => allows(viewer, "center:setup");
const hexId = (kind: string, n: number) =>
  `00000000-0000-4000-8000-${kind}${n.toString(16).padStart(8, "0")}`;
// The first FIRST_WEEKS weeks of a class's weekly slot, in center time.
function plannedAts(c: CenterSetupDraft["classes"][number], from = Date.now()): string[] {
  const [hh, mm] = c.time.split(":").map(Number);
  let cursor = from;
  const ats: string[] = [];
  for (let k = 0; k < c.weekdays.length * FIRST_WEEKS; k++) {
    const at = nextWeeklySlot(c.weekdays, hh, mm, cursor);
    ats.push(at);
    cursor = Date.parse(at);
  }
  return ats;
}

// Teacher double-bookings against the live schedule, and teacher / room clashes inside the draft.
function draftClashes(draft: CenterSetupDraft): string[] {
  const NEW_CENTER = "new-center";
  return findClashes(
    draft.classes.flatMap((c) =>
      c.weekdays.length && /^\d\d:\d\d$/.test(c.time)
        ? plannedAts(c).map((at) => ({
            label: `${c.name.trim() || "a new class"} (new)`,
            at,
            durationMin: c.durationMin,
            teacherId: c.teacherId || null,
            centerId: NEW_CENTER,
            room: c.room || null,
          }))
        : [],
    ),
  ).map((m) => m.replace(" at this center", ""));
}

const takenCodes = (orgId: string) =>
  centers
    .filter((c) => c.orgId === orgId)
    .map((c) => codes[c.id])
    .filter((x): x is string => !!x);

export const mockCenterSetup: CenterSetupPort = {
  getSetupContext: (viewer) =>
    withFault("centerSetup.getSetupContext", () => {
      const org = staffOrg(viewer);
      const o = organizations.find((x) => x.id === org);
      if (!org || !o || !maySetUp(viewer)) return latency<SetupContext | null>(null);
      return latency<SetupContext>({
        orgId: org,
        orgName: o.name,
        brands: brands.filter((b) => b.orgId === org).map((b) => ({ id: b.id, name: b.name })),
        courses: courses
          .filter((c) => c.orgId === org)
          .map((c) => ({ id: c.id, code: c.code, title: c.title, level: c.level })),
        teachers: teachers.filter((t) => t.orgId === org).map((t) => ({ id: t.id, name: t.name })),
        takenCodes: takenCodes(org),
      });
    }),

  createCenter: (viewer, draft: CenterSetupDraft) =>
    withFault("centerSetup.createCenter", () => {
      const org = staffOrg(viewer);
      if (!org) return latency<CenterSetupResult>({ ok: false, reason: "not_staff", failed: [] });
      if (!maySetUp(viewer))
        return latency<CenterSetupResult>({ ok: false, reason: "access_policy", failed: [] });
      // Re-check everything server-side, scoped to this org (brand, courses, teachers too).
      const failed = centerSetupChecklist(draft, takenCodes(org))
        .filter((c) => !c.ok)
        .map((c) => c.key as string);
      const orgCourses = new Set(courses.filter((c) => c.orgId === org).map((c) => c.id));
      const orgTeachers = new Set(teachers.filter((t) => t.orgId === org).map((t) => t.id));
      if (
        !brands.some((b) => b.id === draft.brandId && b.orgId === org) &&
        !failed.includes("info")
      )
        failed.push("info");
      if (draft.courseIds.some((id) => !orgCourses.has(id)) && !failed.includes("courses"))
        failed.push("courses");
      if (draft.classes.some((c) => !orgTeachers.has(c.teacherId)) && !failed.includes("classes"))
        failed.push("classes");
      if (failed.length)
        return latency<CenterSetupResult>({ ok: false, reason: "incomplete", failed });
      const badFees = draft.fees.filter(
        (f) => feeIssues(f).length || !draft.courseIds.includes(f.courseId),
      );
      if (badFees.length)
        return latency<CenterSetupResult>({
          ok: false,
          reason: "invalid_fee",
          failed: badFees.map((f) => f.courseId),
        });

      const clashes = draftClashes(draft);
      if (clashes.length)
        return latency<CenterSetupResult>({ ok: false, reason: "clash", failed: clashes });

      const n = ++seq;
      const centerId = hexId("ce", n);
      centers.push({
        id: centerId,
        orgId: org,
        brandId: draft.brandId,
        name: draft.name.trim(),
        city: draft.city.trim() || "—",
      });
      centerDetails[centerId] = {
        ...centers[centers.length - 1],
        addressLine: draft.addressLine.trim(),
        roomCount: draft.rooms.length,
        activeCourses: draft.courseIds.length,
      };
      codes[centerId] = draft.code.trim().toUpperCase();
      if (draft.fees.length)
        fees.set(
          centerId,
          draft.fees.map((f) => ({ ...f })),
        );

      const classIds: string[] = [];
      let sessionsCreated = 0;
      draft.classes.forEach((c, i) => {
        const classId = hexId(`c${n.toString(16)}`.padEnd(4, "0"), i + 1);
        const course = courses.find((x) => x.id === c.courseId)!;
        const ats = plannedAts(c);
        const days = [...c.weekdays]
          .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
          .map((d) => DAY_LETTERS[d])
          .join("/");
        classes.push({
          id: classId,
          orgId: org,
          centerId,
          courseId: c.courseId,
          name: `${c.name.trim()} — ${days}`,
          learnerCount: 0,
          nextSessionAt: ats[0] ?? null,
        });
        classTeachers[classId] = c.teacherId;
        rosters[classId] = [];
        sessionStore.setClassMeta(classId, { room: c.room, durationMin: c.durationMin });
        ats.forEach((at, k) =>
          sessionStore.add({ classId, title: `${course.code} — Session ${k + 1}`, at }),
        );
        sessionsCreated += ats.length;
        classIds.push(classId);
      });
      return latency<CenterSetupResult>({ ok: true, centerId, classIds, sessionsCreated });
    }),

  previewClashes: (viewer, draft) =>
    withFault("centerSetup.previewClashes", () =>
      latency(staffOrg(viewer) ? draftClashes(draft) : []),
    ),

  getFees: (viewer, centerId) =>
    withFault("centerSetup.getFees", () => {
      const org = staffOrg(viewer);
      const c = centers.find((x) => x.id === centerId);
      if (!org || !c || c.orgId !== org) return latency(null);
      return latency(
        (fees.get(centerId) ?? []).map((f) => ({
          ...f,
          courseCode: courses.find((x) => x.id === f.courseId)?.code ?? "?",
        })),
      );
    }),
};

registerPersistent("centerSetup", {
  dump: () => ({ codes: { ...codes }, fees, seq }),
  load: (raw) => {
    const d = raw as { codes?: Record<string, string>; fees?: unknown; seq?: number };
    for (const k of Object.keys(codes)) if (!(k in SEED_CODES)) delete codes[k];
    Object.assign(codes, d.codes ?? {});
    refill(fees, d.fees);
    seq = Number(d.seq) || 0;
  },
});
