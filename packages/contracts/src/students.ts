import type { IiosGrantedContext } from "./iiosContext.js";
import type { AttendanceMark } from "./attendance.js";

/*
 * Current Students — care for learners already enrolled. ADDITIVE, SYNTHETIC, mock only.
 *
 * Owner decision (22/11): a learner gets ONE of three care levels — ok / watch / needs support —
 * always WITH the evidence behind it ("absent from the last 2 marked sessions", "Speaking dropped
 * 8 after the latest practice"). No psychological or personality labels (no "overwhelmed",
 * "struggling", "flourishing"). Center staff and the learner's own class teacher see it; learners
 * and guardians do not. Nothing here acts on its own: recommendations are suggestions for people.
 * Overdue tuition is shown to staff as information only and never changes the care level.
 */

export type CareLevel = "ok" | "watch" | "support";
export type CareKind =
  | "absence_streak"
  | "low_attendance"
  | "skill_low"
  | "skill_drop"
  | "speaking_returned"
  | "makeup_overdue"
  | "makeup_due"
  | "no_practice";

export interface CareEvidence {
  level: Exclude<CareLevel, "ok">;
  kind: CareKind;
  text: string; // plain words: what the data shows, with its source
}

export interface CareRecommendation {
  kind: CareKind;
  text: string; // a suggestion for a person to act on
  link: string | null; // where in OGC to act
}

export interface StudentCard {
  learnerId: string;
  name: string;
  classes: {
    id: string;
    name: string;
    centerId: string;
    centerName: string;
    teacherName: string | null;
  }[];
  attendance: {
    present: number;
    late: number;
    absent: number;
    marked: number;
    pct: number | null; // (present + late) of marked; null when nothing is marked
    recent: AttendanceMark[]; // the last marked sessions, oldest first (at most 6)
  };
  progressPct: number;
  lastPracticeAt: string | null;
  makeups: { open: number; overdue: number };
  tuition: { balanceVnd: number; overdueVnd: number } | null; // staff with billing access only
  // Class course completion (22/11): lessons completed in the OGC course linked to their class.
  studio: {
    title: string;
    completedLessons: number;
    totalLessons: number;
    lastActivityAt: string | null;
  } | null;
  care: { level: CareLevel; evidence: CareEvidence[] };
  recommendations: CareRecommendation[];
}

export interface StudentsPort {
  // Center staff (within their policy's centers) and a class teacher (own classes). Others: null.
  list(viewer: IiosGrantedContext): Promise<StudentCard[] | null>;
}
