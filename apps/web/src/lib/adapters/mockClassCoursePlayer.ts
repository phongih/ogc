/*
 * Course Studio — the learner side, in My Learning (SYNTHETIC, mock). Owner decisions 22/11: a
 * learner takes the OGC course linked to their class, pinned to the version they started; a quiz
 * score is assessed evidence for the skill profile; reflections are free text, never scored.
 * Self-scoped: a learner grant acts on its own learner record only (fail-closed). A speaking block
 * (owner 23/11) is answered with the lesson; the teacher review that makes it count for Speaking
 * runs on the Platform — the demo keeps the replies and shows the model lines, never as evidence.
 */
import type {
  AuthoringResult,
  BlockOf,
  ClassCoursePlayerPort,
  MyClassCourse,
} from "@ogc/contracts";
import { AUTHORING_LIMITS, hideLessonAnswers, lessonQuizScore } from "@ogc/contracts";
import { classes, rosters } from "../../fixtures/teaching";
import { learnerById } from "../../fixtures/learners";
import { courseOf, latestVersion } from "./mockCourseAuthoring";
import { activeCourseRefOf } from "./mockStudioLinks";
import { recordLesson, recordOf, versionFor } from "./courseProgress";
import { learnerIdOf } from "./viewer";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));
type Out = AuthoringResult & { score?: number | null };
const refuse = (reason: Exclude<AuthoringResult, { ok: true }>["reason"], detail?: string) =>
  latency<Out>({ ok: false, reason, ...(detail ? { detail } : {}) });

/** The learner of a grant and the class courses open to them. */
function scope(viewer: Parameters<ClassCoursePlayerPort["mine"]>[0]) {
  const learnerId = learnerIdOf(viewer);
  const learner = learnerId ? learnerById[learnerId] : undefined;
  if (!learnerId || !learner || learner.orgId !== viewer.orgId) return null;
  const open: { ref: string; className: string }[] = [];
  for (const c of classes) {
    if (c.orgId !== viewer.orgId) continue;
    if (!(rosters[c.id] ?? []).some((r) => r.learnerId === learnerId)) continue;
    const ref = activeCourseRefOf(c.id);
    if (ref && !open.some((o) => o.ref === ref)) open.push({ ref, className: c.name });
  }
  return { learnerId, orgId: viewer.orgId, open };
}

const hideAnswers = hideLessonAnswers;

export const mockClassCoursePlayer: ClassCoursePlayerPort = {
  mine: (viewer) =>
    withFault("classCourses.mine", () => {
      const s = scope(viewer);
      if (!s) return latency(null);
      const out: MyClassCourse[] = [];
      for (const o of s.open) {
        const c = courseOf(o.ref, s.orgId);
        const v = versionFor(o.ref, s.learnerId, s.orgId);
        if (!c || !v) continue;
        const r = recordOf(o.ref, s.learnerId);
        const lessons = v.content.lessons.map((l) => ({
          lessonId: l.id,
          title: l.title,
          completedAt: r?.lessons[l.id]?.at ?? null,
          score: r?.lessons[l.id]?.score ?? null,
        }));
        const done = lessons.filter((l) => l.completedAt).length;
        out.push({
          ref: o.ref,
          className: o.className,
          title: v.content.title,
          summary: v.content.summary,
          version: v.version,
          latestVersion: latestVersion(c)?.version ?? v.version,
          lessons,
          completedLessons: done,
          pct: lessons.length ? Math.round((done / lessons.length) * 100) : 0,
        });
      }
      return latency(out);
    }),

  lesson: (viewer, ref, lessonId) =>
    withFault("classCourses.lesson", () => {
      const s = scope(viewer);
      if (!s || !s.open.some((o) => o.ref === ref)) return latency(null);
      const v = versionFor(ref, s.learnerId, s.orgId);
      const idx = v ? v.content.lessons.findIndex((l) => l.id === lessonId) : -1;
      if (!v || idx < 0) return latency(null);
      const lesson = v.content.lessons[idx];
      const done = recordOf(ref, s.learnerId)?.lessons[lessonId] ?? null;
      return latency({
        ref,
        version: v.version,
        lesson: done ? JSON.parse(JSON.stringify(lesson)) : hideAnswers(lesson),
        index: idx,
        total: v.content.lessons.length,
        completed: done ? JSON.parse(JSON.stringify(done)) : null,
      });
    }),

  complete: (viewer, ref, lessonId, answers, reflections, speaking = {}) =>
    withFault("classCourses.complete", () => {
      const s = scope(viewer);
      if (!s) return refuse("not_allowed", "learners complete their own lessons");
      if (!s.open.some((o) => o.ref === ref)) return refuse("not_found");
      const v = versionFor(ref, s.learnerId, s.orgId);
      const lesson = v?.content.lessons.find((l) => l.id === lessonId);
      if (!v || !lesson) return refuse("not_found");
      if (recordOf(ref, s.learnerId)?.lessons[lessonId])
        return refuse("invalid_step", "already completed");
      const quizzes = lesson.blocks.filter((b): b is BlockOf<"quiz"> => b.kind === "quiz");
      const prompts = lesson.blocks.filter(
        (b): b is BlockOf<"reflection"> => b.kind === "reflection",
      );
      const talks = lesson.blocks.filter((b): b is BlockOf<"speaking"> => b.kind === "speaking");
      const known = new Set([...quizzes, ...prompts].map((b) => b.id));
      if (
        Object.keys(answers).some((k) => !known.has(k)) ||
        Object.keys(reflections).some((k) => !known.has(k)) ||
        Object.keys(speaking).some((k) => !talks.some((t) => t.id === k))
      )
        return refuse("invalid", "answers for blocks that are not in this lesson");
      const keepS: Record<string, number[]> = {};
      for (const t of talks) {
        const c = speaking[t.id];
        if (
          !Array.isArray(c) ||
          c.length !== t.turns.length ||
          c.some((x, i) => !Number.isInteger(x) || x < 0 || x >= t.turns[i].options.length)
        )
          return refuse("invalid", "choose a reply at every speaking turn");
        keepS[t.id] = [...c];
      }
      for (const q of quizzes) {
        const a = answers[q.id];
        if (!Number.isInteger(a) || a < 0 || a >= q.options.length)
          return refuse("invalid", "answer every question");
      }
      for (const p of prompts) {
        const t = (reflections[p.id] ?? "").trim();
        if (!t) return refuse("invalid", "write something for each reflection");
        if (t.length > AUTHORING_LIMITS.reflectionAnswer)
          return refuse(
            "invalid",
            `a reflection is too long (max ${AUTHORING_LIMITS.reflectionAnswer})`,
          );
      }
      const keepA: Record<string, number> = {};
      for (const q of quizzes) keepA[q.id] = answers[q.id];
      const keepR: Record<string, string> = {};
      for (const p of prompts) keepR[p.id] = reflections[p.id].trim();
      const score = lessonQuizScore(lesson, keepA);
      // The first completed lesson pins the learner to this version.
      recordLesson(ref, s.learnerId, s.orgId, v.version, lessonId, {
        at: new Date().toISOString(),
        score,
        answers: keepA,
        reflections: keepR,
        ...(talks.length ? { speaking: keepS } : {}),
      });
      return latency<Out>({ ok: true, score });
    }),
};
