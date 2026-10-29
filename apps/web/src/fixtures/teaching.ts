import type { ClassSummary, LearnerRow, Session } from "@ogc/contracts";
import { organizations, brands, centers } from "./directory";
import { courses } from "./catalog";
import { TEACHER_TARA } from "./personas";

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
    nextSessionAt: "2026-11-02T09:00:00.000Z",
  },
  {
    id: "00000000-0000-4000-8000-0000000000k2",
    orgId: ORG,
    centerId: centers[1].id,
    courseId: courses[1].id,
    name: "B1 Evening — Tue/Thu",
    learnerCount: 9,
    nextSessionAt: "2026-11-03T18:00:00.000Z",
  },
];

// Which synthetic teacher owns which class. Lesson-plan editing is scoped to this.
export const classTeachers: Record<string, string> = {
  [classes[0].id]: TEACHER_TARA,
  [classes[1].id]: TEACHER_TARA,
};

export const upcomingSessions: Session[] = [
  { id: "SES-001", classId: classes[0].id, title: "A2 — Unit 7", at: "2026-11-02T09:00:00.000Z" },
  { id: "SES-002", classId: classes[1].id, title: "B1 — Unit 3", at: "2026-11-03T18:00:00.000Z" },
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
};
