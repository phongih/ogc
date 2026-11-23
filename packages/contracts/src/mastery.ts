/*
 * LI-1 mastery + P1 support signals — PURE, deterministic, shared by the demo (in the browser) and
 * the Platform API (owner 23/11: one copy of the logic, moved here from
 * apps/web/src/features/learning/intelligence/{mastery,support,skills}.ts unchanged).
 */
import type { LearnerProfile, Skill, SkillEvidence, SkillMastery } from "./profile.js";
import type { PlacementResult } from "./placement.js";
import type { SupportSignal } from "./support.js";

// Canonical skill order — the single source of iteration + tie-break order.
export const ALL_SKILLS: readonly Skill[] = ["reading", "use_of_english", "speaking"] as const;

export function skillLabel(skill: Skill): string {
  switch (skill) {
    case "reading":
      return "Reading";
    case "use_of_english":
      return "Use of English";
    case "speaking":
      return "Speaking";
  }
}

/*
 * LI-1 — Pure mastery engine. No React, no I/O, no wall-clock, no RNG.
 *
 * Invariants required by AUTH-021:
 *  - Idempotent by attemptId: a duplicate attempt never updates mastery twice.
 *  - Deterministic evidence ordering: fold order is (at asc, then attemptId asc),
 *    so the INPUT array order never affects the result.
 *  - Recompute-stable: the same evidence set always yields identical output.
 *  - Invalid or non-assessed evidence never modifies mastery (filtered out).
 */

// EWMA weight on the newest evidence. Fixed — not configurable at call sites.
export const MASTERY_ALPHA = 0.4;

const clamp = (n: number): number => Math.max(0, Math.min(100, n));
const roundLevel = (n: number): number => clamp(Math.round(n));

function isValidEvidence(e: SkillEvidence): boolean {
  return (
    typeof e.attemptId === "string" &&
    e.attemptId.length > 0 &&
    (ALL_SKILLS as readonly string[]).includes(e.skill) &&
    Number.isFinite(e.score) &&
    e.score >= 0 &&
    e.score <= 100 &&
    typeof e.at === "string" &&
    e.at.length > 0
  );
}

// Deterministic order + dedup. Pure: does not mutate the input.
export function normalizeEvidence(evidence: readonly SkillEvidence[]): SkillEvidence[] {
  const valid = evidence.filter(isValidEvidence);
  const sorted = [...valid].sort((a, b) => {
    if (a.at < b.at) return -1;
    if (a.at > b.at) return 1;
    if (a.attemptId < b.attemptId) return -1;
    if (a.attemptId > b.attemptId) return 1;
    return 0;
  });
  const seen = new Set<string>();
  const out: SkillEvidence[] = [];
  for (const e of sorted) {
    if (seen.has(e.attemptId)) continue; // idempotency: first occurrence wins
    seen.add(e.attemptId);
    out.push(e);
  }
  return out;
}

// Build the initial profile purely from placement (evidenceCount 0, no timestamp).
export function seedProfile(placement: PlacementResult): LearnerProfile {
  const skills = {} as Record<Skill, SkillMastery>;
  for (const s of ALL_SKILLS) {
    const seed = placement.skillSeed[s];
    skills[s] = {
      level: roundLevel(typeof seed === "number" ? seed : 0),
      evidenceCount: 0,
      lastUpdatedAt: null,
    };
  }
  return {
    learnerId: placement.learnerId,
    orgId: placement.orgId,
    cefrBand: placement.cefrBand,
    skills,
  };
}

// Fold assessed evidence into a profile. Pure: returns a new profile, inputs untouched.
export function updateMastery(
  profile: LearnerProfile,
  evidence: readonly SkillEvidence[],
): LearnerProfile {
  const ordered = normalizeEvidence(evidence);
  const skills = {} as Record<Skill, SkillMastery>;
  for (const s of ALL_SKILLS) skills[s] = { ...profile.skills[s] };

  for (const e of ordered) {
    const m = skills[e.skill];
    const level = roundLevel(MASTERY_ALPHA * e.score + (1 - MASTERY_ALPHA) * m.level);
    const lastUpdatedAt = m.lastUpdatedAt && m.lastUpdatedAt > e.at ? m.lastUpdatedAt : e.at;
    skills[e.skill] = { level, evidenceCount: m.evidenceCount + 1, lastUpdatedAt };
  }

  return { ...profile, skills };
}

// Convenience: seed + fold in one deterministic call.
export function computeProfile(
  placement: PlacementResult,
  evidence: readonly SkillEvidence[],
): LearnerProfile {
  return updateMastery(seedProfile(placement), evidence);
}

/*
 * P1 · Needs-support signals — PURE, deterministic. No new model: it replays the SAME LI-1
 * mastery fold (seed from placement, then updateMastery one evidence at a time in canonical
 * order) and reads off what happened. Thresholds are explicit, versioned constants.
 */
export const SUPPORT_VERSION = "support-v1";
export const SUPPORT_LOW_SKILL = 60; // a skill strictly below this is flagged
export const SUPPORT_DROP = 5; // the latest evidence lowering a skill by ≥ this is flagged

// Decision Engine (21/11): the thresholds are staff-tunable rules; these are the defaults.
export interface SupportThresholds {
  low: number | null; // null = the "skill below threshold" rule is off
  drop: number | null; // null = the "skill dropped" rule is off
}
export const DEFAULT_SUPPORT_THRESHOLDS: SupportThresholds = {
  low: SUPPORT_LOW_SKILL,
  drop: SUPPORT_DROP,
};

export function supportSignals(
  seed: LearnerProfile,
  evidence: readonly SkillEvidence[],
  speakingReturnedCount = 0,
  t: SupportThresholds = DEFAULT_SUPPORT_THRESHOLDS,
): SupportSignal[] {
  let cur = seed;
  const lastDelta = new Map<Skill, number>();
  for (const e of normalizeEvidence(evidence)) {
    const next = updateMastery(cur, [e]);
    lastDelta.set(e.skill, next.skills[e.skill].level - cur.skills[e.skill].level);
    cur = next;
  }

  const out: SupportSignal[] = [];
  for (const skill of ALL_SKILLS) {
    const m = cur.skills[skill];
    const d = lastDelta.get(skill);
    if (t.drop !== null && d !== undefined && d <= -t.drop)
      out.push({
        kind: "skill_drop",
        source: "practice",
        skill,
        level: m.level,
        delta: d,
        evidenceCount: m.evidenceCount,
      });
    if (t.low !== null && m.level < t.low)
      out.push({
        kind: "low_skill",
        source: m.evidenceCount > 0 ? "practice" : "placement",
        skill,
        level: m.level,
        evidenceCount: m.evidenceCount,
        threshold: t.low,
      });
  }
  if (speakingReturnedCount > 0)
    out.push({ kind: "speaking_returned", source: "teacher_review", skill: "speaking" });
  return out;
}

// The skill a teacher should act on first: a drop beats a low skill; evidence beats placement;
// then the lowest level. null when nothing points at a skill.
export function focusSkill(signals: readonly SupportSignal[]): Skill | null {
  const rank = (s: SupportSignal) =>
    (s.kind === "skill_drop" ? 0 : s.kind === "speaking_returned" ? 1 : 2) * 1000 +
    (s.source === "placement" ? 500 : 0) +
    (s.level ?? 0);
  const withSkill = signals.filter((s) => s.skill);
  if (withSkill.length === 0) return null;
  return [...withSkill].sort((a, b) => rank(a) - rank(b))[0].skill ?? null;
}
