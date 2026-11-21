import type { Course } from "@ogc/contracts";
import { organizations, brands } from "./directory";

const ORG = organizations[0].id;
const BRAND = brands[0].id;

export const courses: Course[] = [
  {
    id: "00000000-0000-4000-8000-000000000e01",
    orgId: ORG,
    brandId: BRAND,
    code: "ENG-A2",
    title: "Everyday English A2",
    level: "A2",
    objectives: [
      "Hold short everyday conversations",
      "Describe routines and plans",
      "Read simple texts",
    ],
    durationWeeks: 10,
    format: "in_center",
  },
  {
    id: "00000000-0000-4000-8000-000000000e02",
    orgId: ORG,
    brandId: BRAND,
    code: "ENG-B1",
    title: "Conversational English B1",
    level: "B1",
    objectives: [
      "Express opinions clearly",
      "Handle most travel situations",
      "Write connected text",
    ],
    durationWeeks: 12,
    format: "hybrid",
  },
  {
    id: "00000000-0000-4000-8000-000000000e03",
    orgId: ORG,
    brandId: BRAND,
    code: "IELTS-B2",
    title: "IELTS Foundation B2",
    level: "B2",
    objectives: [
      "Understand exam structure",
      "Build academic vocabulary",
      "Practise all four skills",
    ],
    durationWeeks: 8,
    format: "online",
  },
];
