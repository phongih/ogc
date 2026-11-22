import type { IiosGrantedContext } from "./iiosContext.js";

/*
 * Workforce · Teacher Load — ADDITIVE, SYNTHETIC, mock only (core of EduOS Workforce Planning,
 * sized for a language center). Owner decisions (22/11):
 *  - load = TEACHING HOURS in the next 7 days, from OGC's own schedule (each session's real length;
 *    a substitute's session counts for the substitute; make-up sessions count);
 *  - each teacher has their own TARGET hours / week (full-time or part-time), set by center staff;
 *    bands are % of target — under / meet / over — with org thresholds staff tune;
 *  - SUGGEST ONLY: when a class teacher, a substitute or a new class's teacher is chosen, OGC shows
 *    each candidate's load before → after and any clash, ranked; it never assigns, and going over
 *    the target only warns — it never blocks.
 */

export type Employment = "full_time" | "part_time";
export type LoadBand = "under" | "meet" | "over";

export interface WorkforceSettings {
  underPct: number; // below this % of target → under
  overPct: number; // above this % of target → over
}

export interface LoadPoint {
  hours: number;
  sessions: number;
  pct: number | null; // hours / target; null when the target is 0
  band: LoadBand;
}

export interface TeacherLoad extends LoadPoint {
  teacherId: string;
  name: string;
  employment: Employment;
  targetHours: number;
  classes: number; // classes where they are the class teacher
  breakdown: {
    label: string; // class name
    kind: "class" | "substitute" | "makeup";
    sessions: number;
    hours: number;
  }[];
}

export interface WorkforceOverview {
  windowFrom: string;
  windowTo: string;
  teachers: TeacherLoad[]; // most loaded first
  totalHours: number;
  totalTargetHours: number;
  utilizationPct: number | null; // total hours / total target
  bands: Record<LoadBand, number>;
  settings: WorkforceSettings;
}

export interface LoadCandidate {
  teacherId: string;
  name: string;
  before: LoadPoint;
  after: LoadPoint;
  clashes: string[]; // plain words; empty = fits the schedule
  note: string; // e.g. "fits, stays within target" / "would go over target (130%)"
}

export type WorkforceRefusal = "not_staff" | "not_found" | "invalid" | "access_policy";
export type WorkforceResult =
  { ok: true } | { ok: false; reason: WorkforceRefusal; detail?: string };

export interface WorkforcePort {
  // Center staff of the organization.
  getOverview(viewer: IiosGrantedContext): Promise<WorkforceOverview | null>;
  setTarget(
    viewer: IiosGrantedContext,
    teacherId: string,
    employment: Employment,
    targetHours: number,
  ): Promise<WorkforceResult>;
  updateSettings(viewer: IiosGrantedContext, next: WorkforceSettings): Promise<WorkforceResult>;
  // Suggestions — ranked candidates; nothing is assigned.
  suggestForClass(viewer: IiosGrantedContext, classId: string): Promise<LoadCandidate[] | null>;
  suggestForSession(viewer: IiosGrantedContext, sessionId: string): Promise<LoadCandidate[] | null>;
  suggestForNewClass(
    viewer: IiosGrantedContext,
    weeklyMinutes: number, // the new class's teaching minutes per week (days × length)
  ): Promise<LoadCandidate[] | null>;
}
