import type {
  LearnerProfile,
  PlacementResult,
  Skill,
  SkillEvidence,
  SkillMastery,
} from "@ogc/contracts";
import { ALL_SKILLS } from "./skills";

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
