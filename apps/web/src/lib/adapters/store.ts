import { refill, registerPersistent } from "./persist";
/*
 * NON-PRODUCTION in-memory development store. No DB, no network. (Since 21/11 the demo state is
 * also saved to this browser's localStorage — see persist.ts.)
 * All state is synthetic and scoped by personaId / orgId. Reset on reload.
 */
import type {
  Conversation,
  EnrollmentRecord,
  LessonPlan,
  LearningActivity,
  LearningAttempt,
  LearningEvidence,
  PracticeResult,
  PracticeSubmission,
  PracticeSubmitResult,
  SpeakingReview,
} from "@ogc/contracts";
import { courses } from "../../fixtures/catalog";
import { learnerEnrollments } from "../../fixtures/learning";
import { activities } from "../../fixtures/activities";
import { practiceFor } from "../../fixtures/practice";
import { speakingFor } from "../../fixtures/speaking";
import { organizations } from "../../fixtures/directory";
import { seedConversations } from "../../fixtures/tutor";
import { LEARNER_LINH, personaMap } from "../../fixtures/personas";
import { LEARNER_SEED, learnerById } from "../../fixtures/learners";
import { scorePractice } from "../../features/learning/practice/scoring";

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
        m.set(e.course.id, {
          personaId,
          courseId: e.course.id,
          state: e.state,
          progressPct: e.progressPct,
        });
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

// ── Learning attempts + evidence (keyed by learnerId, the domain subject) ─────
// Identity is separated from the acting persona: attempts belong to a learnerId, so
// roster learners WITHOUT a login persona still own progress (S5-B).
// attempts: Map<learnerId, Map<activityId, LearningAttempt>>
const attempts = new Map<string, Map<string, LearningAttempt>>();
// evidence: Map<learnerId, Map<activityId, LearningEvidence[]>>
const evidence = new Map<string, Map<string, LearningEvidence[]>>();
let attemptSeq = 0;
let evidenceSeq = 0;
// Gamification: the REAL time each completion was recorded (`${learnerId}::${activityId}`).
// completedAt stays deterministic for progress; rewards and streaks need the wall clock.
// Seeded completions have no entry (they fall back to their deterministic completedAt).
const recordedAt = new Map<string, string>();
const markRecorded = (learnerId: string, activityId: string) =>
  recordedAt.set(`${learnerId}::${activityId}`, new Date().toISOString());

// Last deterministic practice result per (learnerId, activityId) — for idempotent replay and
// to surface the structured result to the learner UI. Synthetic, in-memory only.
const practiceResults = new Map<string, PracticeResult>();
const practiceKey = (learnerId: string, activityId: string) => `${learnerId}::${activityId}`;

// P1 speaking studio: latest rehearsal + its review per (learnerId, activityId). Synthetic.
const speakingReviews = new Map<string, SpeakingReview>();
const speakingResults = new Map<string, PracticeResult>();
let speakingSeq = 0;

// Deterministic assessment score (0..100): pure hash of learnerId + activityId.
// NOT random, NOT an external model, repeatable across runs.
function deterministicScore(learnerId: string, activityId: string): number {
  let h = 0;
  const s = `${learnerId}:${activityId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 60 + (h % 41); // 60..100
}

function activityById(activityId: string): LearningActivity | undefined {
  return activities.find((a) => a.id === activityId);
}

function attemptsFor(learnerId: string): Map<string, LearningAttempt> {
  let m = attempts.get(learnerId);
  if (!m) {
    m = new Map();
    attempts.set(learnerId, m);
    // Seed this learner's deterministic completions (covers every roster learner).
    for (const seedId of LEARNER_SEED[learnerId] ?? []) {
      const a = activityById(seedId);
      if (!a) continue;
      const idx = ++attemptSeq;
      m.set(seedId, {
        id: `ATT-${idx}`,
        learnerId,
        activityId: seedId,
        state: "completed",
        completedAt: new Date(LEARNING_EPOCH + idx * 3600000).toISOString(),
        score: a.assessed ? deterministicScore(learnerId, seedId) : null,
      });
    }
  }
  return m;
}

function evidenceFor(learnerId: string): Map<string, LearningEvidence[]> {
  let m = evidence.get(learnerId);
  if (!m) {
    m = new Map();
    evidence.set(learnerId, m);
  }
  return m;
}

export interface CourseProgress {
  totalActivities: number;
  completedActivities: number;
  assessedCount: number;
  progressPct: number;
  state: "not_started" | "in_progress" | "completed";
  lastActivityAt: string | null;
}

// Deterministic weighted progress for a LEARNER in one course. Single source of truth
// consumed by learner/teacher/guardian views (no divergent numbers). Org-scoped: a
// learner only matches activities in their own organization.
function courseProgressFor(learnerId: string, courseId: string): CourseProgress {
  const org = learnerById[learnerId]?.orgId;
  const list = activities.filter((a) => a.courseId === courseId && a.orgId === org);
  const totalWeight = list.reduce((s, a) => s + a.weight, 0);
  let completedWeight = 0;
  let completedActivities = 0;
  let assessedCount = 0;
  let lastActivityAt: string | null = null;
  const m = attemptsFor(learnerId);
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
  const total = list.length;
  const state =
    completedActivities === 0
      ? "not_started"
      : total > 0 && completedActivities === total
        ? "completed"
        : "in_progress";
  return {
    totalActivities: total,
    completedActivities,
    assessedCount,
    progressPct: totalWeight === 0 ? 0 : Math.round((completedWeight / totalWeight) * 100),
    state,
    lastActivityAt,
  };
}

export const learningStore = {
  courseProgress: courseProgressFor,

  getAttempt: (learnerId: string, activityId: string): LearningAttempt | null =>
    attemptsFor(learnerId).get(activityId) ?? null,

  /** Gamification: every completed attempt of a learner, with when it was recorded. */
  completionsOf: (learnerId: string): (LearningAttempt & { recordedAt: string })[] =>
    [...attemptsFor(learnerId).values()]
      .filter((a) => a.state === "completed")
      .map((a) => ({
        ...a,
        recordedAt:
          recordedAt.get(`${learnerId}::${a.activityId}`) ??
          a.completedAt ??
          new Date(LEARNING_EPOCH).toISOString(),
      })),

  /** Latest evidence time for a learner (any activity), or null. Decision Engine "no practice". */
  lastEvidenceAt: (learnerId: string): string | null => {
    let last: string | null = null;
    for (const list of evidenceFor(learnerId).values())
      for (const e of list) if (!last || e.at > last) last = e.at;
    return last;
  },

  getEvidence: (learnerId: string, activityId: string): LearningEvidence[] =>
    (evidenceFor(learnerId).get(activityId) ?? []).map((e) => ({ ...e })),

  // Fail-closed + idempotent completion. The ACTOR is a persona; the SUBJECT is that
  // persona's own learnerId. A persona can only complete activities for itself.
  complete: (personaId: string, activityId: string): { completed: boolean; reason?: string } => {
    const learnerId = personaMap[personaId]?.learnerId;
    if (!learnerId) return { completed: false, reason: "not_a_learner" };

    const activity = activityById(activityId);
    if (!activity) return { completed: false, reason: "unknown_activity" };

    // Must belong to the persona's organization.
    if (activity.orgId !== personaMap[personaId]?.orgId)
      return { completed: false, reason: "cross_org_denied" };

    // Must be enrolled in the activity's course (reuses the persona-keyed enrollment store).
    if (!enrollMapFor(personaId).has(activity.courseId))
      return { completed: false, reason: "not_enrolled" };

    const m = attemptsFor(learnerId);
    const existing = m.get(activityId);
    if (existing?.state === "completed") return { completed: false, reason: "already_completed" };

    const idx = ++attemptSeq;
    const score = activity.assessed ? deterministicScore(learnerId, activityId) : null;
    const completedAt = new Date(LEARNING_EPOCH + idx * 3600000).toISOString();
    m.set(activityId, {
      id: existing?.id ?? `ATT-${idx}`,
      learnerId,
      activityId,
      state: "completed",
      completedAt,
      score,
    });

    markRecorded(learnerId, activityId);
    // AI-generated feedback is recorded as EVIDENCE, separate from the score.
    const ev = evidenceFor(learnerId);
    const list = ev.get(activityId) ?? [];
    list.push({
      id: `EVID-${++evidenceSeq}`,
      learnerId,
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

  getPracticeResult: (learnerId: string, activityId: string): PracticeResult | null =>
    practiceResults.get(practiceKey(learnerId, activityId)) ?? null,

  // Fail-closed + idempotent practice submission. The SCORE is derived from the learner's
  // responses (deterministic scorer), NOT a hash. A completed attempt is written so the
  // existing LI-1 mastery pipeline picks it up unchanged. Idempotency key = submission.attemptId:
  // replaying the same attemptId returns the prior result and never double-counts.
  submitPractice: (
    personaId: string,
    activityId: string,
    submission: PracticeSubmission,
  ): PracticeSubmitResult => {
    const learnerId = personaMap[personaId]?.learnerId;
    if (!learnerId) return { ok: false, reason: "not_a_learner" };

    const activity = activityById(activityId);
    if (!activity) return { ok: false, reason: "unknown_activity" };
    if (activity.orgId !== personaMap[personaId]?.orgId)
      return { ok: false, reason: "cross_org_denied" };
    if (!enrollMapFor(personaId).has(activity.courseId))
      return { ok: false, reason: "not_enrolled" };

    const practice = practiceFor(activityId);
    if (!practice) return { ok: false, reason: "practice_not_available" };
    if (!submission.attemptId || submission.attemptId.trim().length === 0)
      return { ok: false, reason: "attempt_id_required" };

    const m = attemptsFor(learnerId);
    const existing = m.get(activityId);
    if (existing?.state === "completed") {
      // Idempotent replay of the SAME attempt → return the prior result, do not re-count.
      if (existing.id === submission.attemptId) {
        const prior = practiceResults.get(practiceKey(learnerId, activityId));
        return prior
          ? { ok: true, result: prior, idempotentReplay: true }
          : { ok: false, reason: "already_completed" };
      }
      // A different attempt against an already-completed activity is rejected (no double-count).
      return { ok: false, reason: "already_completed" };
    }

    // Deterministic score from the learner's own responses.
    const result = scorePractice(practice, learnerId, submission);
    const idx = ++attemptSeq;
    const completedAt = new Date(LEARNING_EPOCH + idx * 3600000).toISOString();
    m.set(activityId, {
      id: submission.attemptId, // attemptId is the attempt identity → mastery idempotency key
      learnerId,
      activityId,
      state: "completed",
      completedAt,
      score: result.score,
    });

    markRecorded(learnerId, activityId);
    // Structured practice evidence (separate from the score; summary only, no answer leakage).
    const ev = evidenceFor(learnerId);
    const list = ev.get(activityId) ?? [];
    list.push({
      id: `EVID-${++evidenceSeq}`,
      learnerId,
      activityId,
      kind: "practice_result",
      text: `correct ${result.correct}/${result.total} · ${result.scoringVersion}`,
      at: completedAt,
    });
    ev.set(activityId, list);

    practiceResults.set(practiceKey(learnerId, activityId), result);
    return { ok: true, result };
  },

  // ── P1 · Speaking studio (MOCK) — rehearsal → teacher review → only then mastery ──────────
  // A rehearsal is scored deterministically but writes NO attempt: it stays a pending review.
  // Retry is allowed while pending/returned (latest rehearsal replaces the previous one); once a
  // teacher approves, the completed attempt is written and the activity is closed.
  submitSpeaking: (
    personaId: string,
    activityId: string,
    submission: PracticeSubmission,
  ): {
    ok: boolean;
    reason?: string;
    result?: PracticeResult;
    review?: SpeakingReview;
    idempotentReplay?: boolean;
  } => {
    const learnerId = personaMap[personaId]?.learnerId;
    if (!learnerId) return { ok: false, reason: "not_a_learner" };
    const activity = activityById(activityId);
    if (!activity) return { ok: false, reason: "unknown_activity" };
    const orgId = personaMap[personaId]?.orgId;
    if (activity.orgId !== orgId || !orgId) return { ok: false, reason: "cross_org_denied" };
    if (!enrollMapFor(personaId).has(activity.courseId))
      return { ok: false, reason: "not_enrolled" };
    const script = speakingFor(activityId);
    if (!script) return { ok: false, reason: "speaking_not_available" };
    if (!submission.attemptId || submission.attemptId.trim().length === 0)
      return { ok: false, reason: "attempt_id_required" };

    const key = practiceKey(learnerId, activityId);
    const existing = speakingReviews.get(key);
    if (existing && existing.attemptId === submission.attemptId) {
      const prior = speakingResults.get(key);
      return prior
        ? { ok: true, result: prior, review: { ...existing }, idempotentReplay: true }
        : { ok: false, reason: "replay_unavailable" };
    }
    if (
      existing?.status === "approved" ||
      attemptsFor(learnerId).get(activityId)?.state === "completed"
    )
      return { ok: false, reason: "already_completed" };

    const result = scorePractice(script, learnerId, submission);
    const review: SpeakingReview = {
      learnerId,
      orgId,
      activityId,
      attemptId: submission.attemptId,
      status: "pending",
      submittedAt: new Date(LEARNING_EPOCH + ++speakingSeq * 60000).toISOString(),
      reviewedAt: null,
      reviewerNote: null,
    };
    speakingReviews.set(key, review);
    speakingResults.set(key, result);
    return { ok: true, result, review: { ...review } };
  },

  getSpeaking: (
    learnerId: string,
    activityId: string,
  ): { review: SpeakingReview; result: PracticeResult } | null => {
    const key = practiceKey(learnerId, activityId);
    const review = speakingReviews.get(key);
    const result = speakingResults.get(key);
    return review && result ? { review: { ...review }, result } : null;
  },

  listSpeaking: (learnerIds: string[], status: SpeakingReview["status"]): SpeakingReview[] =>
    [...speakingReviews.values()]
      .filter((r) => learnerIds.includes(r.learnerId) && r.status === status)
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .map((r) => ({ ...r })),

  // Caller (adapter) has already authorized the reviewing teacher. Only a PENDING review can be
  // approved; approval writes the completed attempt + evidence so LI-1 mastery picks it up.
  approveSpeaking: (
    learnerId: string,
    activityId: string,
  ): { ok: boolean; reason?: string; review?: SpeakingReview } => {
    const key = practiceKey(learnerId, activityId);
    const review = speakingReviews.get(key);
    const result = speakingResults.get(key);
    if (!review || !result) return { ok: false, reason: "no_rehearsal" };
    if (review.status !== "pending") return { ok: false, reason: `not_pending:${review.status}` };
    const m = attemptsFor(learnerId);
    if (m.get(activityId)?.state === "completed") return { ok: false, reason: "already_completed" };

    const idx = ++attemptSeq;
    const completedAt = new Date(LEARNING_EPOCH + idx * 3600000).toISOString();
    m.set(activityId, {
      id: review.attemptId,
      learnerId,
      activityId,
      state: "completed",
      completedAt,
      score: result.score,
    });
    markRecorded(learnerId, activityId);
    const ev = evidenceFor(learnerId);
    const list = ev.get(activityId) ?? [];
    list.push({
      id: `EVID-${++evidenceSeq}`,
      learnerId,
      activityId,
      kind: "practice_result",
      text: `speaking rehearsal approved by teacher · natural replies ${result.correct}/${result.total} · ${result.scoringVersion}`,
      at: completedAt,
    });
    ev.set(activityId, list);
    practiceResults.set(key, result);
    const next: SpeakingReview = {
      ...review,
      status: "approved",
      reviewedAt: completedAt,
      reviewerNote: null,
    };
    speakingReviews.set(key, next);
    return { ok: true, review: { ...next } };
  },

  returnSpeaking: (
    learnerId: string,
    activityId: string,
    note: string,
  ): { ok: boolean; reason?: string; review?: SpeakingReview } => {
    const key = practiceKey(learnerId, activityId);
    const review = speakingReviews.get(key);
    if (!review) return { ok: false, reason: "no_rehearsal" };
    if (review.status !== "pending") return { ok: false, reason: `not_pending:${review.status}` };
    if (!note || note.trim().length === 0) return { ok: false, reason: "note_required" };
    const next: SpeakingReview = {
      ...review,
      status: "returned",
      reviewedAt: new Date(LEARNING_EPOCH + ++speakingSeq * 60000).toISOString(),
      reviewerNote: note.trim(),
    };
    speakingReviews.set(key, next);
    return { ok: true, review: { ...next } };
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
      for (const c of seedConversations)
        list.push({ ...c, personaId, messages: c.messages.map((m) => ({ ...m })) });
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
  create: (
    personaId: string,
    orgId: string,
    title: string,
    lessonContext: Conversation["lessonContext"],
  ) => {
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
  // In-memory rename/delete, fail-closed to the persona's own conversations (a foreign
  // conversationId is never found in this persona's list, so it cannot be touched).
  rename: (personaId: string, conversationId: string, title: string): boolean => {
    const c = convFor(personaId).find((x) => x.id === conversationId);
    if (!c) return false;
    c.title = title;
    return true;
  },
  remove: (personaId: string, conversationId: string): boolean => {
    const list = convFor(personaId);
    const i = list.findIndex((x) => x.id === conversationId);
    if (i < 0) return false;
    list.splice(i, 1);
    return true;
  },
};

registerPersistent("learning", {
  dump: () => ({
    enrollments,
    plans,
    planSeq,
    attempts,
    evidence,
    attemptSeq,
    evidenceSeq,
    practiceResults,
    speakingReviews,
    speakingResults,
    speakingSeq,
    convByPersona,
    convSeq,
    recordedAt,
  }),
  load: (raw) => {
    const d = raw as Record<string, unknown>;
    refill(enrollments, d.enrollments);
    refill(plans, d.plans);
    refill(attempts, d.attempts);
    refill(evidence, d.evidence);
    refill(practiceResults, d.practiceResults);
    refill(speakingReviews, d.speakingReviews);
    refill(speakingResults, d.speakingResults);
    refill(convByPersona, d.convByPersona);
    refill(recordedAt, d.recordedAt);
    planSeq = Number(d.planSeq) || 0;
    attemptSeq = Number(d.attemptSeq) || 0;
    evidenceSeq = Number(d.evidenceSeq) || 0;
    speakingSeq = Number(d.speakingSeq) || 0;
    convSeq = Number(d.convSeq) || 0;
  },
});
