/*
 * NON-PRODUCTION in-memory development store. No DB, no persistence, no network.
 * All state is synthetic and scoped by personaId / orgId. Reset on reload.
 */
import type { Conversation, EnrollmentRecord, LessonPlan } from "@ogc/contracts";
import { courses } from "../../fixtures/catalog";
import { learnerEnrollments } from "../../fixtures/learning";
import { organizations } from "../../fixtures/directory";
import { seedConversations } from "../../fixtures/tutor";
import { LEARNER_LINH, personaMap } from "../../fixtures/personas";

const ORG = organizations[0].id;

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
