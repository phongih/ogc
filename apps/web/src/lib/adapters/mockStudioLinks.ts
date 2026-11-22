/*
 * Learning Studio links — MOCK adapter (SYNTHETIC). Owner decisions 22/11 (see
 * packages/contracts/src/studio.ts): OGC keeps only a course reference per class; the class
 * teacher proposes, staff (courses:link) link / reject / unlink; only completion comes back from
 * Learning Studio; weekly prep hours on a link count in Workforce. No EduOS code or content.
 */
import type {
  ClassCourseLink,
  IiosGrantedContext,
  LearnerStudioProgress,
  LinkStatus,
  StudioLinksPort,
  StudioResult,
} from "@ogc/contracts";
import { centers } from "../../fixtures/directory";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { teacherName } from "../../fixtures/personas";
import { studioCourse, studioCourses, studioProgress } from "../integration/mockLearningStudio";
import { allows, centerScope, inScope } from "./accessPolicy";
import { displayNameOf, staffOrgOf, teacherIdOf } from "./viewer";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
type Refusal = Exclude<StudioResult, { ok: true }>;
const refuse = (reason: Refusal["reason"], detail?: string) =>
  latency<StudioResult>({ ok: false, reason, ...(detail ? { detail } : {}) });
const ok = () => latency<StudioResult>({ ok: true });
const DAY = 86_400_000;
export const MAX_PREP_HOURS = 10;

interface StoredLink {
  id: string;
  orgId: string;
  classId: string;
  courseRef: string;
  status: LinkStatus;
  prepHoursPerWeek: number;
  proposedBy: string | null;
  proposedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
}

const links = new Map<string, StoredLink>();
let seq = 0;

function seed() {
  const now = Date.now();
  const add = (l: Omit<StoredLink, "id">) => {
    const id = `SL-${++seq}`;
    links.set(id, { ...l, id });
  };
  // A2 Morning already follows a Learning Studio course; Tara proposed one for B1 Evening.
  add({
    orgId: classes[0].orgId,
    classId: classes[0].id,
    courseRef: "LS-A2-EVERYDAY",
    status: "linked",
    prepHoursPerWeek: 0,
    proposedBy: null,
    proposedAt: null,
    decidedBy: "Sam (Org Staff)",
    decidedAt: new Date(now - 20 * DAY).toISOString(),
    reason: null,
  });
  add({
    orgId: classes[1].orgId,
    classId: classes[1].id,
    courseRef: "LS-B1-SPEAK",
    status: "proposed",
    prepHoursPerWeek: 0,
    proposedBy: "Tara (Teacher)",
    proposedAt: new Date(now - 2 * DAY).toISOString(),
    decidedBy: null,
    decidedAt: null,
    reason: null,
  });
}
function reset() {
  links.clear();
  seq = 0;
  seed();
}
sessionStore.onReset(reset);
export const __resetStudioLinksForTests = reset;
registerPersistent("studioLinks", {
  dump: () => ({ links, seq }),
  load: (raw) => {
    const r = raw as { links?: unknown; seq?: number };
    refill(links, r.links);
    if (typeof r.seq === "number") seq = r.seq;
  },
});
reset();

// ── helpers ─────────────────────────────────────────────────────────────────────────────────
const classOf = (id: string) => classes.find((c) => c.id === id);
const centerName = (id: string) => centers.find((c) => c.id === id)?.name ?? "Center";
const activeLinkOf = (classId: string) =>
  [...links.values()].find((l) => l.classId === classId && l.status === "linked") ?? null;

function canDecide(viewer: IiosGrantedContext, classId: string): boolean {
  const c = classOf(classId);
  return !!c && !!staffOrgOf(viewer) && allows(viewer, "courses:link", { centerId: c.centerId });
}

function view(l: StoredLink, viewer: IiosGrantedContext): ClassCourseLink | null {
  const c = classOf(l.classId);
  const course = studioCourse(l.courseRef);
  if (!c || !course) return null;
  return {
    id: l.id,
    classId: c.id,
    className: c.name,
    centerId: c.centerId,
    centerName: centerName(c.centerId),
    course,
    status: l.status,
    prepHoursPerWeek: l.prepHoursPerWeek,
    proposedBy: l.proposedBy,
    proposedAt: l.proposedAt,
    decidedBy: l.decidedBy,
    decidedAt: l.decidedAt,
    reason: l.reason,
    mineToDecide: l.status === "proposed" && canDecide(viewer, c.id),
  };
}

/** Classes the viewer sees: staff within their courses:link centers, a teacher their own. */
function visibleClasses(viewer: IiosGrantedContext) {
  const staffOrg = staffOrgOf(viewer);
  if (staffOrg) {
    const scope = centerScope(viewer, "courses:link");
    if (scope === "none") return null;
    return {
      role: "staff" as const,
      list: classes.filter((c) => c.orgId === staffOrg && inScope(scope, c.centerId)),
    };
  }
  const t = teacherIdOf(viewer);
  if (t)
    return {
      role: "teacher" as const,
      list: classes.filter((c) => c.orgId === viewer.orgId && classTeachers[c.id] === t),
    };
  return null;
}

// ── read-only hooks for other modules ─────────────────────────────────────────────────────────

/** Workforce: weekly prep hours of linked courses whose class this teacher teaches. */
export function prepHoursOf(
  teacherId: string,
): { classId: string; className: string; hours: number }[] {
  return [...links.values()]
    .filter(
      (l) =>
        l.status === "linked" && l.prepHoursPerWeek > 0 && classTeachers[l.classId] === teacherId,
    )
    .map((l) => ({
      classId: l.classId,
      className: classOf(l.classId)?.name ?? "a class",
      hours: l.prepHoursPerWeek,
    }));
}

/** Current Students: Learning Studio completion of a learner in their linked classes. */
export function studioOfLearner(
  learnerId: string,
  classIds: string[],
  now = Date.now(),
): {
  title: string;
  completedLessons: number;
  totalLessons: number;
  lastActivityAt: string | null;
} | null {
  for (const id of classIds) {
    const l = activeLinkOf(id);
    const course = l ? studioCourse(l.courseRef) : null;
    if (!l || !course) continue;
    const p = studioProgress(
      l.courseRef,
      learnerId,
      Date.parse(l.decidedAt ?? new Date(now).toISOString()),
      now,
    );
    return { title: course.title, ...p };
  }
  return null;
}

/** Decision Engine: learners of linked classes with no Learning Studio activity for `days`. */
export function studioInactiveLearners(orgId: string, days: number, now = Date.now()) {
  const out: {
    learnerId: string;
    name: string;
    classId: string;
    className: string;
    course: string;
    since: string;
  }[] = [];
  for (const l of links.values()) {
    if (l.orgId !== orgId || l.status !== "linked") continue;
    const linkedAt = Date.parse(l.decidedAt ?? "");
    if (!Number.isFinite(linkedAt) || now - linkedAt < days * DAY) continue; // give a new link time
    const course = studioCourse(l.courseRef);
    for (const r of rosters[l.classId] ?? []) {
      const p = studioProgress(l.courseRef, r.learnerId, linkedAt, now);
      const last = p.lastActivityAt ? Date.parse(p.lastActivityAt) : linkedAt;
      if (p.completedLessons < p.totalLessons && now - last >= days * DAY)
        out.push({
          learnerId: r.learnerId,
          name: r.displayName,
          classId: l.classId,
          className: classOf(l.classId)?.name ?? "a class",
          course: course?.title ?? l.courseRef,
          since: new Date(last).toISOString(),
        });
    }
  }
  return out;
}

// ── port ────────────────────────────────────────────────────────────────────────────────────
export const mockStudioLinks: StudioLinksPort = {
  getOverview: (viewer) =>
    withFault("studio.overview", () => {
      const v = visibleClasses(viewer);
      if (!v) return latency(null);
      const ids = new Set(v.list.map((c) => c.id));
      return latency({
        role: v.role,
        classes: v.list.map((c) => ({
          id: c.id,
          name: c.name,
          centerName: centerName(c.centerId),
          teacherName: teacherName(classTeachers[c.id]),
        })),
        links: [...links.values()]
          .filter((l) => ids.has(l.classId))
          .sort((a, b) =>
            (b.decidedAt ?? b.proposedAt ?? "").localeCompare(a.decidedAt ?? a.proposedAt ?? ""),
          )
          .map((l) => view(l, viewer))
          .filter((x): x is ClassCourseLink => x !== null),
        canLink: v.role === "staff",
      });
    }),

  searchCourses: (viewer, query) =>
    withFault("studio.search", () => {
      if (!visibleClasses(viewer)) return latency(null);
      return latency(studioCourses(query.slice(0, 60)));
    }),

  propose: (viewer, classId, courseRef) =>
    withFault("studio.propose", () => {
      const t = teacherIdOf(viewer);
      const c = classOf(classId);
      if (!t || !c || c.orgId !== viewer.orgId || classTeachers[classId] !== t)
        return refuse("not_allowed", "only the class teacher proposes a course for the class");
      const course = studioCourse(courseRef);
      if (!course) return refuse("not_found");
      if (!course.linkable)
        return refuse("invalid_step", `${course.title} has no published version`);
      if (activeLinkOf(classId)?.courseRef === courseRef)
        return refuse("invalid_step", "already linked to this class");
      if (
        [...links.values()].some(
          (l) => l.classId === classId && l.courseRef === courseRef && l.status === "proposed",
        )
      )
        return refuse("invalid_step", "already proposed");
      const id = `SL-${++seq}`;
      links.set(id, {
        id,
        orgId: c.orgId,
        classId,
        courseRef,
        status: "proposed",
        prepHoursPerWeek: 0,
        proposedBy: displayNameOf(viewer),
        proposedAt: new Date().toISOString(),
        decidedBy: null,
        decidedAt: null,
        reason: null,
      });
      return ok();
    }),

  link: (viewer, classId, courseRef, prepHoursPerWeek) =>
    withFault("studio.link", () => {
      const c = classOf(classId);
      const org = staffOrgOf(viewer);
      if (!org || !c || c.orgId !== org) return refuse("not_allowed", "center staff link courses");
      if (!allows(viewer, "courses:link", { centerId: c.centerId })) return refuse("access_policy");
      const course = studioCourse(courseRef);
      if (!course) return refuse("not_found");
      if (!course.linkable)
        return refuse("invalid_step", `${course.title} has no published version`);
      if (activeLinkOf(classId))
        return refuse("invalid_step", "the class already follows a course — unlink it first");
      if (!(prepHoursPerWeek >= 0 && prepHoursPerWeek <= MAX_PREP_HOURS))
        return refuse("invalid", `prep hours: 0–${MAX_PREP_HOURS} per week`);
      const now = new Date().toISOString();
      const proposal = [...links.values()].find(
        (l) => l.classId === classId && l.courseRef === courseRef && l.status === "proposed",
      );
      const l: StoredLink = proposal ?? {
        id: `SL-${++seq}`,
        orgId: org,
        classId,
        courseRef,
        status: "linked",
        prepHoursPerWeek: 0,
        proposedBy: null,
        proposedAt: null,
        decidedBy: null,
        decidedAt: null,
        reason: null,
      };
      l.status = "linked";
      l.prepHoursPerWeek = Math.round(prepHoursPerWeek * 2) / 2;
      l.decidedBy = displayNameOf(viewer);
      l.decidedAt = now;
      links.set(l.id, l);
      return ok();
    }),

  reject: (viewer, linkId, reason) =>
    withFault("studio.reject", () => {
      const l = links.get(linkId);
      if (!l || l.orgId !== viewer.orgId) return refuse("not_found");
      if (!canDecide(viewer, l.classId)) return refuse("access_policy");
      if (l.status !== "proposed") return refuse("invalid_step", `already ${l.status}`);
      const r = reason.trim();
      if (r.length < 3 || r.length > 200)
        return refuse("invalid", "give a reason (3–200 characters)");
      l.status = "rejected";
      l.reason = r;
      l.decidedBy = displayNameOf(viewer);
      l.decidedAt = new Date().toISOString();
      return ok();
    }),

  unlink: (viewer, linkId, reason) =>
    withFault("studio.unlink", () => {
      const l = links.get(linkId);
      if (!l || l.orgId !== viewer.orgId) return refuse("not_found");
      if (!canDecide(viewer, l.classId)) return refuse("access_policy");
      if (l.status !== "linked") return refuse("invalid_step", `not linked (${l.status})`);
      const r = reason.trim();
      if (r.length < 3 || r.length > 200)
        return refuse("invalid", "give a reason (3–200 characters)");
      l.status = "unlinked";
      l.reason = r;
      l.decidedBy = displayNameOf(viewer);
      l.decidedAt = new Date().toISOString();
      return ok();
    }),

  setPrepHours: (viewer, linkId, hours) =>
    withFault("studio.prep", () => {
      const l = links.get(linkId);
      if (!l || l.orgId !== viewer.orgId) return refuse("not_found");
      if (!canDecide(viewer, l.classId)) return refuse("access_policy");
      if (l.status !== "linked") return refuse("invalid_step", "only a linked course");
      if (!(hours >= 0 && hours <= MAX_PREP_HOURS))
        return refuse("invalid", `prep hours: 0–${MAX_PREP_HOURS} per week`);
      l.prepHoursPerWeek = Math.round(hours * 2) / 2;
      return ok();
    }),

  progress: (viewer, linkId) =>
    withFault("studio.progress", () => {
      const v = visibleClasses(viewer);
      const l = links.get(linkId);
      if (!v || !l || l.status !== "linked" || !v.list.some((c) => c.id === l.classId))
        return latency(null);
      const now = Date.now();
      const linkedAt = Date.parse(l.decidedAt ?? new Date(now).toISOString());
      return latency(
        (rosters[l.classId] ?? []).map((r): LearnerStudioProgress => {
          const p = studioProgress(l.courseRef, r.learnerId, linkedAt, now);
          return {
            learnerId: r.learnerId,
            name: r.displayName,
            completedLessons: p.completedLessons,
            totalLessons: p.totalLessons,
            pct: p.totalLessons ? Math.round((p.completedLessons / p.totalLessons) * 100) : 0,
            lastActivityAt: p.lastActivityAt,
          };
        }),
      );
    }),
};
