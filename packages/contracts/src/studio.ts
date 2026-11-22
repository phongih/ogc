import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Learning Studio links — ADDITIVE, SYNTHETIC, mock only. Owner decisions (22/11):
 *  - teachers author interactive courses in EduOS Learning Studio (review, publication history,
 *    analytics live there). OGC does NOT rebuild an editor and copies no EduOS code or content:
 *    it only keeps a reference (course code + link) attached to a class, shown read-only;
 *  - only completion comes back: per learner, lessons completed of the course and the last
 *    activity. It shows on Current Students and the Decision Engine may read it (a "no Learning
 *    Studio activity" rule, off by default). No quiz scores, no content;
 *  - the class teacher PROPOSES a course for their class; center staff (courses:link, within their
 *    centers) link it — or reject with a reason, or unlink. Only a course with a published
 *    version can be linked; an archived or never-published course cannot;
 *  - preparing a linked course may count in Workforce: staff set the weekly prep hours on the
 *    link; they add to the class teacher's load (0 = not counted).
 * Learning Studio itself is a MOCK here (lib/integration) until EduOS offers a real API.
 */

export type StudioCourseStatus = "published" | "unpublished_changes" | "draft" | "archived";

export interface StudioCourse {
  ref: string; // Learning Studio course code, e.g. LS-A2-EVERYDAY
  title: string;
  lessons: number;
  status: StudioCourseStatus;
  updatedAt: string;
  url: string; // opens the course in Learning Studio (synthetic, never fetched by OGC)
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
