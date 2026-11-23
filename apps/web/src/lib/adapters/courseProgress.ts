/*
 * Course Studio — learner progress in OGC-authored courses (SYNTHETIC). One record per learner and
 * course, PINNED to the published version the learner started (owner 22/11: learners stay on the
 * version they are learning). A completed lesson keeps its quiz score; scores are assessed
 * evidence for the skill profile (use of English). Reflections are kept for the teacher, never
 * scored.
 */
import type { SkillEvidence } from "@ogc/contracts";
import { learnerById } from "../../fixtures/learners";
import { courseOf, latestVersion, versionOf } from "./mockCourseAuthoring";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";

const DAY = 86_400_000;

export interface LessonDone {
  at: string;
  score: number | null;
  answers: Record<string, number>;
  reflections: Record<string, string>;
  speaking?: Record<string, number[]>; // speaking block → reply per turn (no teacher review in the demo)
}
export interface CourseProgressRecord {
  ref: string;
  learnerId: string;
  orgId: string;
  version: number; // pinned
  lessons: Record<string, LessonDone>;
}

const records = new Map<string, CourseProgressRecord>();
const key = (ref: string, learnerId: string) => `${ref}::${learnerId}`;

function seed() {
  // An P. (A2 Morning) started the A2 course on v1, 18 days ago — still pinned to v1 after v2.
  const an = "00000000-0000-4000-8000-00000000L003";
  const org = learnerById[an]?.orgId ?? "";
  records.set(key("CS-A2-EVERYDAY", an), {
    ref: "CS-A2-EVERYDAY",
    learnerId: an,
    orgId: org,
    version: 1,
    lessons: {
      "a2-l1": {
        at: new Date(Date.now() - 18 * DAY).toISOString(),
        score: 100,
        answers: { "a2-l1-b4": 1 },
        reflections: {},
      },
    },
  });
}
function reset() {
  records.clear();
  seed();
}
sessionStore.onReset(reset);
export const __resetCourseProgressForTests = reset;
registerPersistent("courseProgress", {
  dump: () => ({ records }),
  load: (raw) => refill(records, (raw as { records?: unknown }).records),
});
reset();

export const recordOf = (ref: string, learnerId: string): CourseProgressRecord | null =>
  records.get(key(ref, learnerId)) ?? null;

/** The version a learner sees: their pin, else the latest published one. */
export function versionFor(ref: string, learnerId: string, orgId: string) {
  const c = courseOf(ref, orgId);
  if (!c) return null;
  const r = recordOf(ref, learnerId);
  return (r ? versionOf(c, r.version) : null) ?? latestVersion(c);
}

/** Completion of one learner in one course (of the version they are on). */
export function completionOf(ref: string, learnerId: string, orgId: string) {
  const v = versionFor(ref, learnerId, orgId);
  if (!v) return null;
  const r = recordOf(ref, learnerId);
  const done = v.content.lessons.filter((l) => r?.lessons[l.id]);
  const last =
    done
      .map((l) => r!.lessons[l.id].at)
      .sort()
      .pop() ?? null;
  return {
    version: v.version,
    title: v.content.title,
    completedLessons: done.length,
    totalLessons: v.content.lessons.length,
    lastActivityAt: last,
  };
}

export function recordLesson(
  ref: string,
  learnerId: string,
  orgId: string,
  version: number,
  lessonId: string,
  done: LessonDone,
): void {
  const r = recordOf(ref, learnerId) ?? { ref, learnerId, orgId, version, lessons: {} };
  r.lessons[lessonId] = done;
  records.set(key(ref, learnerId), r);
}

/** Skill profile: each completed lesson with a quiz is one assessed piece of evidence. */
export function courseQuizEvidenceOf(learnerId: string, orgId: string): SkillEvidence[] {
  const out: SkillEvidence[] = [];
  for (const r of records.values()) {
    if (r.learnerId !== learnerId || r.orgId !== orgId) continue;
    for (const [lessonId, d] of Object.entries(r.lessons))
      if (d.score !== null)
        out.push({
          attemptId: `CS:${r.ref}:v${r.version}:${lessonId}`,
          skill: "use_of_english",
          score: d.score,
          at: d.at,
        });
  }
  return out;
}
