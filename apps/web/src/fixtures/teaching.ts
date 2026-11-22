import type { ClassSummary, LearnerRow, Session } from "@ogc/contracts";
import { organizations, brands, centers } from "./directory";
import { courses } from "./catalog";
import { TEACHER_BEN, TEACHER_TARA } from "./personas";
import { A2_EVENING_NEXT, A2_MORNING_NEXT, B1_EVENING_NEXT } from "./demoClock";

const ORG = organizations[0].id;
void brands;

export const classes: ClassSummary[] = [
  {
    id: "00000000-0000-4000-8000-0000000000k1",
    orgId: ORG,
    centerId: centers[0].id,
    courseId: courses[0].id,
    name: "A2 Morning — Mon/Wed",
    learnerCount: 12,
    nextSessionAt: A2_MORNING_NEXT,
  },
  {
    id: "00000000-0000-4000-8000-0000000000k2",
    orgId: ORG,
    centerId: centers[1].id,
    courseId: courses[1].id,
    name: "B1 Evening — Tue/Thu",
    learnerCount: 9,
    nextSessionAt: B1_EVENING_NEXT,
  },
  // P2 · make-up: a second A2 class, one unit behind A2 Morning, taught by Ben. A learner who
  // missed a unit in A2 Morning can join the same unit here.
  {
    id: "00000000-0000-4000-8000-0000000000k3",
    orgId: ORG,
    centerId: centers[0].id,
    courseId: courses[0].id,
    name: "A2 Evening — Tue/Thu",
    learnerCount: 8,
    nextSessionAt: A2_EVENING_NEXT,
  },
];

// Which synthetic teacher owns which class. Lesson-plan editing, rosters, attendance and the
// support queue are scoped to this. P2: LIVE in-memory assignment — center staff can reassign a
// class (mockSchedule); `sessionStore.reset()` restores this seed.
export const classTeachers: Record<string, string> = {
  [classes[0].id]: TEACHER_TARA,
  [classes[1].id]: TEACHER_TARA,
  [classes[2].id]: TEACHER_BEN,
};

export const upcomingSessions: Session[] = [
  { id: "SES-001", classId: classes[0].id, title: "A2 — Unit 7", at: A2_MORNING_NEXT },
  { id: "SES-002", classId: classes[1].id, title: "B1 — Unit 3", at: B1_EVENING_NEXT },
];

export const rosters: Record<string, LearnerRow[]> = {
  [classes[0].id]: [
    { learnerId: "00000000-0000-4000-8000-00000000L001", displayName: "Linh N.", progressPct: 62 },
    { learnerId: "00000000-0000-4000-8000-00000000L002", displayName: "Minh T.", progressPct: 44 },
    { learnerId: "00000000-0000-4000-8000-00000000L003", displayName: "An P.", progressPct: 78 },
  ],
  [classes[1].id]: [
    { learnerId: "00000000-0000-4000-8000-00000000L004", displayName: "Huy D.", progressPct: 15 },
    { learnerId: "00000000-0000-4000-8000-00000000L005", displayName: "Thao V.", progressPct: 23 },
  ],
  [classes[2].id]: [
    { learnerId: "00000000-0000-4000-8000-00000000L006", displayName: "Khoa L.", progressPct: 40 },
    { learnerId: "00000000-0000-4000-8000-00000000L007", displayName: "Vy H.", progressPct: 35 },
  ],
};

/**
 * How many learners a class has — counted from its live roster. The `learnerCount` on each class
 * above is a seed placeholder and is NOT shown anywhere (22/11: Teaching showed 9 for a class with
 * fewer learners on its roster).
 */
export const learnerCountOf = (classId: string): number => rosters[classId]?.length ?? 0;
