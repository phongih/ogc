import type { LearningActivity } from "@ogc/contracts";
import { organizations } from "./directory";
import { courses } from "./catalog";
import { lessons } from "./learning";

const ORG = organizations[0].id;

// Deterministic synthetic learning activities per course. NON-PRODUCTION demo data.
export const activities: LearningActivity[] = [
  // Everyday English A2 (courses[0]) — tied to its lessons where relevant.
  {
    id: "ACT-A2-1",
    orgId: ORG,
    courseId: courses[0].id,
    lessonId: lessons[0].id,
    title: "Read: Making weekend plans",
    kind: "reading",
    weight: 1,
    assessed: false,
  },
  {
    id: "ACT-A2-2",
    orgId: ORG,
    courseId: courses[0].id,
    lessonId: lessons[0].id,
    title: "Exercise: 'be going to'",
    kind: "exercise",
    weight: 1,
    assessed: false,
  },
  {
    id: "ACT-A2-3",
    orgId: ORG,
    courseId: courses[0].id,
    lessonId: lessons[2].id,
    title: "Quiz: At the market",
    kind: "quiz",
    weight: 2,
    assessed: true,
  },
  {
    id: "ACT-A2-4",
    orgId: ORG,
    courseId: courses[0].id,
    lessonId: null,
    title: "Speaking: Describe your weekend",
    kind: "speaking",
    weight: 2,
    assessed: true,
  },

  // Conversational English B1 (courses[1]).
  {
    id: "ACT-B1-1",
    orgId: ORG,
    courseId: courses[1].id,
    lessonId: lessons[1].id,
    title: "Read: Giving opinions",
    kind: "reading",
    weight: 1,
    assessed: false,
  },
  {
    id: "ACT-B1-2",
    orgId: ORG,
    courseId: courses[1].id,
    lessonId: lessons[1].id,
    title: "Quiz: Opinion phrases",
    kind: "quiz",
    weight: 2,
    assessed: true,
  },

  // IELTS Foundation B2 (courses[2]).
  {
    id: "ACT-B2-1",
    orgId: ORG,
    courseId: courses[2].id,
    lessonId: null,
    title: "Read: Exam structure",
    kind: "reading",
    weight: 1,
    assessed: false,
  },
  {
    id: "ACT-B2-2",
    orgId: ORG,
    courseId: courses[2].id,
    lessonId: null,
    title: "Exercise: Academic vocabulary",
    kind: "exercise",
    weight: 1,
    assessed: false,
  },
];
