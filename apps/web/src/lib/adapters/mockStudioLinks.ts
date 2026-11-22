/*
 * Class courses — MOCK adapter (SYNTHETIC). Owner decisions 22/11 (see
 * packages/contracts/src/studio.ts): a class follows one OGC-authored course (Course Studio); the
 * class teacher proposes, staff (courses:link) link / reject / unlink; completion comes from the
 * learners' own progress (courseProgress); weekly prep hours on a link count in Workforce.
 */
import type {
  ClassCourseLink,
  IiosGrantedContext,
  LearnerStudioProgress,
  LinkStatus,
  StudioCourse,
  StudioLinksPort,
  StudioResult,
} from "@ogc/contracts";
import { centers } from "../../fixtures/directory";
import { classTeachers, classes, rosters } from "../../fixtures/teaching";
import { teacherName } from "../../fixtures/personas";
import {
  __setLinkedClassesLookup,
  courseOf,
  coursesOfOrg,
  latestVersion,
  statusOf,
  type StoredCourse,
} from "./mockCourseAuthoring";
import { completionOf } from "./courseProgress";
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
  // A2 Morning already follows a course; Tara proposed one for B1 Evening.
  add({
    orgId: classes[0].orgId,
    classId: classes[0].id,
    courseRef: "CS-A2-EVERYDAY",
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
    courseRef: "CS-B1-SPEAK",
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
__setLinkedClassesLookup((ref) =>
  [...links.values()]
    .filter((l) => l.courseRef === ref && l.status === "linked")
    .map((l) => classes.find((c) => c.id === l.classId)?.name ?? "a class"),
);

// ── helpers ─────────────────────────────────────────────────────────────────────────────────
const classOf = (id: string) => classes.find((c) => c.id === id);
const centerName = (id: string) => centers.find((c) => c.id === id)?.name ?? "Center";
function courseView(c: StoredCourse): StudioCourse {
  const last = latestVersion(c);
  return {
    ref: c.ref,
    title: last?.content.title ?? c.draft.title,
    lessons: last?.content.lessons.length ?? 0,
    version: last?.version ?? null,
    status: statusOf(c),
    updatedAt: c.updatedAt,
    linkable: !!last,
  };
}
const studioCourse = (ref: string, orgId: string): StudioCourse | null => {
  const c = courseOf(ref, orgId);
  return c ? courseView(c) : null;
};
const activeLinkOf = (classId: string) =>
  [...links.values()].find((l) => l.classId === classId && l.status === "linked") ?? null;

function canDecide(viewer: IiosGrantedContext, classId: string): boolean {
  const c = classOf(classId);
  return !!c && !!staffOrgOf(viewer) && allows(viewer, "courses:link", { centerId: c.centerId });
}

function view(l: StoredLink, viewer: IiosGrantedContext): ClassCourseLink | null {
  const c = classOf(l.classId);
  const course = studioCourse(l.courseRef, l.orgId);
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

/** My Learning: the course a class follows right now (linked), or null. */
export const activeCourseRefOf = (classId: string): string | null =>
  activeLinkOf(classId)?.courseRef ?? null;

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

/** Current Students: course completion of a learner in their linked classes. */
export function studioOfLearner(
  learnerId: string,
  classIds: string[],
): {
  title: string;
  completedLessons: number;
  totalLessons: number;
  lastActivityAt: string | null;
} | null {
  for (const id of classIds) {
    const l = activeLinkOf(id);
    const p = l ? completionOf(l.courseRef, learnerId, l.orgId) : null;
    if (!p) continue;
    return {
      title: p.title,
      completedLessons: p.completedLessons,
      totalLessons: p.totalLessons,
      lastActivityAt: p.lastActivityAt,
    };
  }
  return null;
}

/** Decision Engine: learners of linked classes with no course activity for `days`. */
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
    for (const r of rosters[l.classId] ?? []) {
      const p = completionOf(l.courseRef, r.learnerId, l.orgId);
      if (!p) continue;
      const last = p.lastActivityAt ? Math.max(Date.parse(p.lastActivityAt), linkedAt) : linkedAt;
      if (p.completedLessons < p.totalLessons && now - last >= days * DAY)
        out.push({
          learnerId: r.learnerId,
          name: r.displayName,
          classId: l.classId,
          className: classOf(l.classId)?.name ?? "a class",
          course: p.title,
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
      const q = query.slice(0, 60).trim().toLowerCase();
      return latency(
        coursesOfOrg(viewer.orgId)
          // A teacher finds published courses and their own; staff every course of the org.
          .filter(
            (c) =>
              !teacherIdOf(viewer) ||
              !!latestVersion(c) ||
              c.ownerTeacherId === teacherIdOf(viewer),
          )
          .map(courseView)
          .filter((c) => !q || `${c.ref} ${c.title}`.toLowerCase().includes(q))
          .sort(
            (a, b) => Number(b.linkable) - Number(a.linkable) || a.title.localeCompare(b.title),
          ),
      );
    }),

  propose: (viewer, classId, courseRef) =>
    withFault("studio.propose", () => {
      const t = teacherIdOf(viewer);
      const c = classOf(classId);
      if (!t || !c || c.orgId !== viewer.orgId || classTeachers[classId] !== t)
        return refuse("not_allowed", "only the class teacher proposes a course for the class");
      const course = studioCourse(courseRef, c.orgId);
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
      const course = studioCourse(courseRef, org);
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
      return latency(
        (rosters[l.classId] ?? []).map((r): LearnerStudioProgress => {
          const p = completionOf(l.courseRef, r.learnerId, l.orgId);
          const done = p?.completedLessons ?? 0;
          const total = p?.totalLessons ?? 0;
          return {
            learnerId: r.learnerId,
            name: r.displayName,
            completedLessons: done,
            totalLessons: total,
            pct: total ? Math.round((done / total) * 100) : 0,
            lastActivityAt: p?.lastActivityAt ?? null,
            version: p?.version ?? null,
          };
        }),
      );
    }),
};
