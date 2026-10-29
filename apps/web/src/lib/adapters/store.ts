/*
 * NON-PRODUCTION in-memory development store. No DB, no persistence, no network.
 * All state is synthetic and scoped by personaId / orgId. Reset on reload.
 */
import type {
  Conversation,
  EnrollmentRecord,
  LessonPlan,
  LearningActivity,
  LearningAttempt,
  LearningEvidence,
} from "@ogc/contracts";
import { courses } from "../../fixtures/catalog";
import { learnerEnrollments } from "../../fixtures/learning";
import { activities } from "../../fixtures/activities";
import { organizations } from "../../fixtures/directory";
import { seedConversations } from "../../fixtures/tutor";
import { LEARNER_LINH, personaMap } from "../../fixtures/personas";

const ORG = organizations[0].id;

// Fixed base time so completion timestamps are deterministic (no wall-clock).
export const LEARNING_EPOCH = Date.parse("2026-10-21T08:00:00.000Z");

// ── Enrollments: Map<personaId, Map<courseId, EnrollmentRecord>> ─────────────
const enrollments = new Map<string, Map<string, EnrollmentRecord>>();
function enrollMapFor(personaId: string): Map<string, EnrollmentRecord> {
  let m = enrollments.get(personaId);
  if (!m) {
    m = new Map();
    enrollments.set(personaId, m);
    // Seed the demo learner's existing enrollments once.
    if (personaMap[personaId]?.learnerId === LEARNER_LINH) {
      for (const e of learnerEnrollments) {
        m.set(e.course.id, { personaId, courseId: e.course.id, state: e.state, progressPct: e.progressPct });
      }
    }
  }
  return m;
}
export const enrollmentStore = {
  list: (personaId: string): EnrollmentRecord[] => [...enrollMapFor(personaId).values()],
  get: (personaId: string, courseId: string) => enrollMapFor(personaId).get(courseId),
  enroll: (personaId: string, courseId: string): { enrolled: boolean; reason?: string } => {
    const m = enrollMapFor(personaId);
    if (m.has(courseId)) return { enrolled: false, reason: "already_enrolled" }; // prevent duplicates
    if (!courses.some((c) => c.id === courseId && c.orgId === personaMap[personaId]?.orgId))
      return { enrolled: false, reason: "course_not_in_org" };
    m.set(courseId, { personaId, courseId, state: "enrolled", progressPct: 0 });
    return { enrolled: true };
  },
};

// ── Lesson plans: Map<planId, LessonPlan> ────────────────────────────────────
const plans = new Map<string, LessonPlan>();
let planSeq = 0;
export const lessonPlanStore = {
  all: (): LessonPlan[] => [...plans.values()],
  listForClass: (classId: string) => [...plans.values()].filter((p) => p.classId === classId),
  get: (planId: string) => plans.get(planId) ?? null,
  upsert: (p: LessonPlan): LessonPlan => {
    plans.set(p.id, p);
    return p;
  },
  nextId: () => `PLAN-${++planSeq}`,
};

// ── Learning attempts + evidence (per persona, per activity) ─────────────────
// attempts: Map<personaId, Map<activityId, LearningAttempt>>
const attempts = new Map<string, Map<string, LearningAttempt>>();
// evidence: Map<personaId, Map<activityId, LearningEvidence[]>>
const evidence = new Map<string, Map<string, LearningEvidence[]>>();
let attemptSeq = 0;
let evidenceSeq = 0;

function attemptsFor(personaId: string): Map<string, LearningAttempt> {
  let m = attempts.get(personaId);
  if (!m) {
    m = new Map();
    attempts.set(personaId, m);
    // Seed a deterministic baseline for the primary demo learner so the unified journey
    // shows consistent, non-zero progress across learner/teacher/guardian from the start.
    if (personaMap[personaId]?.learnerId === LEARNER_LINH) {
      for (const seedId of ["ACT-A2-1", "ACT-A2-2"]) {
        const a = activities.find((x) => x.id === seedId);
        if (!a) continue;
        const idx = ++attemptSeq;
        m.set(seedId, {
          id: `ATT-${idx}`,
          personaId,
          activityId: seedId,
          state: "completed",
          completedAt: new Date(LEARNING_EPOCH + idx * 3600000).toISOString(),
          score: a.assessed ? deterministicScore(personaId, seedId) : null,
        });
      }
    }
  }
  return m;
}

// Deterministic weighted progress for a persona in one course. Single source of truth
// used by both the learner dashboard and the learning views (no divergent numbers).
function courseProgressFor(personaId: string, courseId: string) {
  const org = personaMap[personaId]?.orgId;
  const list = activities.filter((a) => a.courseId === courseId && a.orgId === org);
  const totalWeight = list.reduce((s, a) => s + a.weight, 0);
  let completedWeight = 0;
  let completedActivities = 0;
  let assessedCount = 0;
  let lastActivityAt: string | null = null;
  const m = attemptsFor(personaId);
  for (const a of list) {
    const att = m.get(a.id);
    if (att?.state === "completed") {
      completedWeight += a.weight;
      completedActivities += 1;
      if (att.score !== null) assessedCount += 1;
      if (att.completedAt && (!lastActivityAt || att.completedAt > lastActivityAt))
        lastActivityAt = att.completedAt;
    }
  }
  return {
    totalActivities: list.length,
    completedActivities,
    assessedCount,
    progressPct: totalWeight === 0 ? 0 : Math.round((completedWeight / totalWeight) * 100),
    lastActivityAt,
  };
}
function evidenceFor(personaId: string): Map<string, LearningEvidence[]> {
  let m = evidence.get(personaId);
  if (!m) {
    m = new Map();
    evidence.set(personaId, m);
  }
  return m;
}

// Deterministic assessment score (0..100) for an assessed activity: pure hash of
// personaId + activityId. NOT random, NOT an external model, repeatable across runs.
function deterministicScore(personaId: string, activityId: string): number {
  let h = 0;
  const s = `${personaId}:${activityId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 60 + (h % 41); // 60..100
}

function activityById(activityId: string): LearningActivity | undefined {
  return activities.find((a) => a.id === activityId);
}

export const learningStore = {
  courseProgress: courseProgressFor,

  getAttempt: (personaId: string, activityId: string): LearningAttempt | null =>
    attemptsFor(personaId).get(activityId) ?? null,

  getEvidence: (personaId: string, activityId: string): LearningEvidence[] =>
    (evidenceFor(personaId).get(activityId) ?? []).map((e) => ({ ...e })),

  // Fail-closed + idempotent completion.
  complete: (personaId: string, activityId: string): { completed: boolean; reason?: string } => {
    const activity = activityById(activityId);
    if (!activity) return { completed: false, reason: "unknown_activity" };

    // Must belong to the persona's organization.
    if (activity.orgId !== personaMap[personaId]?.orgId)
      return { completed: false, reason: "cross_org_denied" };

    // Must be enrolled in the activity's course (reuses the enrollment store).
    const enrolled = enrollMapFor(personaId).has(activity.courseId);
    if (!enrolled) return { completed: false, reason: "not_enrolled" };

    const m = attemptsFor(personaId);
    const existing = m.get(activityId);
    if (existing?.state === "completed") return { completed: false, reason: "already_completed" };

    const idx = ++attemptSeq;
    const score = activity.assessed ? deterministicScore(personaId, activityId) : null;
    const completedAt = new Date(LEARNING_EPOCH + idx * 3600000).toISOString();
    m.set(activityId, {
      id: existing?.id ?? `ATT-${idx}`,
      personaId,
      activityId,
      state: "completed",
      completedAt,
      score,
    });

    // AI-generated feedback is recorded as EVIDENCE, separate from the score.
    const ev = evidenceFor(personaId);
    const list = ev.get(activityId) ?? [];
    list.push({
      id: `EVID-${++evidenceSeq}`,
      personaId,
      activityId,
      kind: "ai_feedback",
      text:
        activity.kind === "speaking"
          ? "Clear attempt. Work on linking words to sound more natural."
          : "Completed. Review the examples once more to reinforce the pattern.",
      at: completedAt,
    });
    ev.set(activityId, list);

    return { completed: true };
  },
};

// ── Tutor conversations: Map<personaId, Conversation[]> ──────────────────────
const convByPersona = new Map<string, Conversation[]>();
let convSeq = 0;
function convFor(personaId: string): Conversation[] {
  let list = convByPersona.get(personaId);
  if (!list) {
    list = [];
    convByPersona.set(personaId, list);
    // Seed only the primary demo learner with history; other personas start empty (separation).
    if (personaMap[personaId]?.learnerId === LEARNER_LINH) {
      for (const c of seedConversations) list.push({ ...c, personaId, messages: c.messages.map((m) => ({ ...m })) });
    }
  }
  return list;
}
export const tutorStore = {
  list: (personaId: string): Conversation[] =>
    convFor(personaId).map((c) => ({ ...c, messages: c.messages.slice() })),
  // Returns a conversation ONLY if it belongs to personaId (fail-closed cross-persona).
  get: (personaId: string, conversationId: string): Conversation | null => {
    const c = convFor(personaId).find((x) => x.id === conversationId);
    return c ? { ...c, messages: c.messages.slice() } : null;
  },
  raw: (personaId: string, conversationId: string): Conversation | null =>
    convFor(personaId).find((x) => x.id === conversationId) ?? null,
  create: (personaId: string, orgId: string, title: string, lessonContext: Conversation["lessonContext"]) => {
    const conv: Conversation = {
      id: `CONV-NEW-${++convSeq}`,
      orgId: orgId || ORG,
      personaId,
      title,
      lessonContext,
      messages: [],
    };
    convFor(personaId).push(conv);
    return { ...conv, messages: [] };
  },
};
