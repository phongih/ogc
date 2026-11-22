/*
 * MOCK of EduOS Learning Studio, as OGC sees it from outside (owner 22/11). SYNTHETIC: course
 * codes, titles and counts only — no lesson content, no EduOS code. OGC reads two things:
 * the course list (to link a course to a class) and per-learner completion (lessons completed,
 * last activity). Replace with the real EduOS API when there is one.
 */
import type { StudioCourse, StudioCourseStatus } from "@ogc/contracts";

const DAY = 86_400_000;
const BASE_URL = "https://studio.eduos.example.invalid/courses";

const COURSES: {
  ref: string;
  title: string;
  lessons: number;
  status: StudioCourseStatus;
  ago: number;
}[] = [
  {
    ref: "LS-A2-EVERYDAY",
    title: "A2 Everyday English — Units 6–8",
    lessons: 6,
    status: "published",
    ago: 5,
  },
  {
    ref: "LS-B1-SPEAK",
    title: "B1 Speaking Confidence",
    lessons: 5,
    status: "unpublished_changes",
    ago: 3,
  },
  {
    ref: "LS-IELTS-W1",
    title: "IELTS Writing Task 1 — Charts",
    lessons: 4,
    status: "published",
    ago: 12,
  },
  { ref: "LS-A2-PHONICS", title: "A2 Pronunciation Lab", lessons: 3, status: "draft", ago: 1 },
  {
    ref: "LS-OLD-GRAMMAR",
    title: "Grammar Basics (2025)",
    lessons: 8,
    status: "archived",
    ago: 200,
  },
];

const view = (c: (typeof COURSES)[number], now: number): StudioCourse => ({
  ref: c.ref,
  title: c.title,
  lessons: c.lessons,
  status: c.status,
  updatedAt: new Date(now - c.ago * DAY).toISOString(),
  url: `${BASE_URL}/${c.ref}`,
  linkable: c.status === "published" || c.status === "unpublished_changes",
});

export function studioCourses(query = "", now = Date.now()): StudioCourse[] {
  const q = query.trim().toLowerCase();
  return COURSES.filter(
    (c) => !q || c.title.toLowerCase().includes(q) || c.ref.toLowerCase().includes(q),
  ).map((c) => view(c, now));
}
export function studioCourse(ref: string, now = Date.now()): StudioCourse | null {
  const c = COURSES.find((x) => x.ref === ref);
  return c ? view(c, now) : null;
}

/** Deterministic synthetic number in [0, n) from a key. */
function pick(key: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % n;
}

/**
 * Completion of one learner in one course, counted from when the course was linked to the class.
 * Synthetic and stable: the same learner + course give the same answer.
 */
export function studioProgress(
  ref: string,
  learnerId: string,
  linkedAt: number,
  now = Date.now(),
): { completedLessons: number; totalLessons: number; lastActivityAt: string | null } {
  const c = COURSES.find((x) => x.ref === ref);
  if (!c) return { completedLessons: 0, totalLessons: 0, lastActivityAt: null };
  const done = pick(`${ref}:${learnerId}:done`, c.lessons + 1);
  if (done === 0) return { completedLessons: 0, totalLessons: c.lessons, lastActivityAt: null };
  const daysAgo = pick(`${ref}:${learnerId}:last`, 21);
  const last = Math.max(linkedAt, now - daysAgo * DAY);
  return {
    completedLessons: done,
    totalLessons: c.lessons,
    lastActivityAt: new Date(last).toISOString(),
  };
}
