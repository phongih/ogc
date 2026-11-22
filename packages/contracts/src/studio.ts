import type { IiosGrantedContext } from "./iiosContext.js";
import type { AuthoredStatus } from "./authoring.js";

/*
 * Class courses — which OGC-authored course a class follows. ADDITIVE, SYNTHETIC, mock only.
 * Owner decisions 22/11 (the Learning Studio link of #63, now pointing at courses OGC writes
 * itself — see authoring.ts; EduOS is a separate product and is not involved):
 *  - the class teacher PROPOSES a course for their class; center staff (courses:link, within their
 *    centers) link it — or reject with a reason, or unlink. Only a course with a published
 *    version can be linked;
 *  - completion comes from the learners' own progress in My Learning (lessons completed of the
 *    version each learner is on, last activity) and shows on Current Students; the Decision
 *    Engine may read it (a "no course activity" rule, off by default);
 *  - preparing a linked course may count in Workforce: staff set the weekly prep hours on the
 *    link; they add to the class teacher's load (0 = not counted).
 */

export type StudioCourseStatus = AuthoredStatus;

export interface StudioCourse {
  ref: string; // OGC course code, e.g. CS-A2-EVERYDAY
  title: string;
  lessons: number; // of the latest published version
  version: number | null; // latest published version
  status: StudioCourseStatus;
  updatedAt: string;
  linkable: boolean; // has a published version
}

export type LinkStatus = "proposed" | "linked" | "rejected" | "unlinked";

export interface ClassCourseLink {
  id: string;
  classId: string;
  className: string;
  centerId: string;
  centerName: string;
  course: StudioCourse;
  status: LinkStatus;
  prepHoursPerWeek: number;
  proposedBy: string | null;
  proposedAt: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null; // why rejected / unlinked
  mineToDecide: boolean; // the viewer may link / reject it
}

export interface LearnerStudioProgress {
  learnerId: string;
  name: string;
  completedLessons: number;
  totalLessons: number;
  pct: number;
  lastActivityAt: string | null;
  version: number | null; // the version this learner is on
}

export interface StudioOverview {
  role: "staff" | "teacher";
  classes: { id: string; name: string; centerName: string; teacherName: string | null }[];
  links: ClassCourseLink[]; // newest first
  canLink: boolean;
}

export type StudioRefusal =
  "not_allowed" | "not_found" | "invalid" | "invalid_step" | "access_policy";
export type StudioResult = { ok: true } | { ok: false; reason: StudioRefusal; detail?: string };

export interface StudioLinksPort {
  // Staff (courses:link, their centers) and class teachers (own classes). Others: null.
  getOverview(viewer: IiosGrantedContext): Promise<StudioOverview | null>;
  searchCourses(viewer: IiosGrantedContext, query: string): Promise<StudioCourse[] | null>;
  propose(viewer: IiosGrantedContext, classId: string, courseRef: string): Promise<StudioResult>;
  link(
    viewer: IiosGrantedContext,
    classId: string,
    courseRef: string,
    prepHoursPerWeek: number,
  ): Promise<StudioResult>;
  reject(viewer: IiosGrantedContext, linkId: string, reason: string): Promise<StudioResult>;
  unlink(viewer: IiosGrantedContext, linkId: string, reason: string): Promise<StudioResult>;
  setPrepHours(viewer: IiosGrantedContext, linkId: string, hours: number): Promise<StudioResult>;
  progress(viewer: IiosGrantedContext, linkId: string): Promise<LearnerStudioProgress[] | null>;
}
