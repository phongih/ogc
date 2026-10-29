/*
 * Synthetic catalog data for the public backend. NON-PRODUCTION demo data only.
 * Mirrors the shape used by the frontend fixtures but is OWNED by the service, so
 * the backend has no dependency on the web app. Includes a `published` flag and an
 * unpublished course to exercise public-visibility rules, and a second organization
 * to exercise org scoping + cross-org isolation.
 */
export type CourseLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";
export type CourseFormat = "in_center" | "online" | "hybrid";

export interface InternalCourse {
  id: string;
  orgId: string; // internal — NEVER exposed publicly
  brandId: string; // internal — NEVER exposed publicly
  code: string;
  title: string;
  level: CourseLevel;
  format: CourseFormat;
  durationWeeks: number;
  objectives: string[];
  published: boolean; // only published courses are publicly visible
}

export interface InternalOrg {
  orgId: string;
  slug: string;
  name: string;
}

const NOVA = "00000000-0000-4000-8000-000000000001";
const LUMEN = "00000000-0000-4000-8000-000000000002";
const NOVA_BRAND = "00000000-0000-4000-8000-0000000000a1";
const LUMEN_BRAND = "00000000-0000-4000-8000-0000000000b1";

export const organizations: InternalOrg[] = [
  { orgId: NOVA, slug: "nova-learning", name: "Nova Learning Group" },
  { orgId: LUMEN, slug: "lumen-edu", name: "Lumen Education Holdings" },
];

export const courses: InternalCourse[] = [
  {
    id: "00000000-0000-4000-8000-000000000e01",
    orgId: NOVA,
    brandId: NOVA_BRAND,
    code: "ENG-A2",
    title: "Everyday English A2",
    level: "A2",
    format: "in_center",
    durationWeeks: 10,
    objectives: ["Hold short everyday conversations", "Describe routines and plans", "Read simple texts"],
    published: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000e02",
    orgId: NOVA,
    brandId: NOVA_BRAND,
    code: "ENG-B1",
    title: "Conversational English B1",
    level: "B1",
    format: "hybrid",
    durationWeeks: 12,
    objectives: ["Express opinions clearly", "Handle most travel situations", "Write connected text"],
    published: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000e03",
    orgId: NOVA,
    brandId: NOVA_BRAND,
    code: "IELTS-B2",
    title: "IELTS Foundation B2",
    level: "B2",
    format: "online",
    durationWeeks: 8,
    objectives: ["Understand exam structure", "Build academic vocabulary", "Practise all four skills"],
    published: true,
  },
  {
    // Intentionally UNPUBLISHED — must never appear in public responses.
    id: "00000000-0000-4000-8000-000000000e04",
    orgId: NOVA,
    brandId: NOVA_BRAND,
    code: "ENG-C1",
    title: "Advanced English C1 (draft)",
    level: "C1",
    format: "in_center",
    durationWeeks: 12,
    objectives: ["(unpublished draft)"],
    published: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000f01",
    orgId: LUMEN,
    brandId: LUMEN_BRAND,
    code: "BUS-B2",
    title: "Business English B2",
    level: "B2",
    format: "online",
    durationWeeks: 9,
    objectives: ["Write professional emails", "Lead meetings", "Negotiate"],
    published: true,
  },
];
