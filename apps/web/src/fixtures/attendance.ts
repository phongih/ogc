/*
 * P2 · Synthetic session history for the two demo classes. NON-PRODUCTION.
 * Past sessions are the real, already-started occurrences of each class's weekly slot in center
 * time (computed at load, like the upcoming ones), so the demo never shows stale dates.
 *
 * Seeded marks tell a small story the owner can check on the live demo:
 *  - A2: the latest started session is NOT marked yet ("to mark"); An was absent last time,
 *    so marking her absent again raises the attendance signal in the support queue.
 *  - B1: Huy was absent from both marked sessions — he is flagged by attendance alone.
 */
import type { AttendanceMark } from "@ogc/contracts";
import { recentWeeklySlots, A2_MORNING_NEXT, B1_EVENING_NEXT } from "./demoClock";
import { classes } from "./teaching";
import { LEARNER_LINH, LEARNER_MINH } from "./personas";
import { LEARNER_AN, LEARNER_HUY, LEARNER_THAO } from "./learners";

export interface SeedSession {
  id: string;
  classId: string;
  title: string;
  at: string;
  seededMarks: Record<string, AttendanceMark> | null; // null = started but not marked
}

const A2 = classes[0].id;
const B1 = classes[1].id;
const LOADED_AT = Date.now();

const a2Past = recentWeeklySlots([1, 3], 9, 4, LOADED_AT); // Units 3–6
const b1Past = recentWeeklySlots([2, 4], 18, 2, LOADED_AT); // Units 1–2

const a2Marks: Array<Record<string, AttendanceMark> | null> = [
  { [LEARNER_LINH]: "present", [LEARNER_MINH]: "present", [LEARNER_AN]: "present" },
  { [LEARNER_LINH]: "present", [LEARNER_MINH]: "late", [LEARNER_AN]: "present" },
  { [LEARNER_LINH]: "present", [LEARNER_MINH]: "present", [LEARNER_AN]: "absent" },
  null, // latest started session — the teacher still has to mark it
];
const b1Marks: Array<Record<string, AttendanceMark>> = [
  { [LEARNER_HUY]: "absent", [LEARNER_THAO]: "present" },
  { [LEARNER_HUY]: "absent", [LEARNER_THAO]: "late" },
];

export const seedSessions: SeedSession[] = [
  ...a2Past.map((at, i) => ({
    id: `A2-${at.slice(0, 10)}`,
    classId: A2,
    title: `A2 — Unit ${3 + i}`,
    at,
    seededMarks: a2Marks[i] ?? null,
  })),
  { id: "SES-001", classId: A2, title: "A2 — Unit 7", at: A2_MORNING_NEXT, seededMarks: null },
  ...b1Past.map((at, i) => ({
    id: `B1-${at.slice(0, 10)}`,
    classId: B1,
    title: `B1 — Unit ${1 + i}`,
    at,
    seededMarks: b1Marks[i] ?? null,
  })),
  { id: "SES-002", classId: B1, title: "B1 — Unit 3", at: B1_EVENING_NEXT, seededMarks: null },
];

// attendance-v1: absent from this many marked sessions in a row → support signal.
export const ABSENCE_STREAK_THRESHOLD = 2;
