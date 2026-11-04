import type {
  AssessmentType,
  ConfidenceBand,
  QualityEvidence,
  Skill,
  SkillConfidence,
} from "@ogc/contracts";
import { ALL_SKILLS } from "./skills";

/*
 * LI-2 — Pure confidence engine. No React, no I/O, no RNG, no wall-clock.
 *
 * Confidence is computed SEPARATELY from mastery level: it blends four deterministic
 * evidence-quality dimensions (each 0..100) into a single 0..100 confidence per skill:
 *   validity        — share of considered evidence that is valid
 *   coverage        — valid evidence count / the skill's assessable surface (capped 1)
 *   recency         — how recent the skill's newest evidence is (ranked across the learner)
 *   typeReliability — mean reliability of the evidence's assessment types
 */

const TYPE_WEIGHT: Record<AssessmentType, number> = { objective: 1.0, subjective: 0.6 };
const W = { validity: 0.2, coverage: 0.4, recency: 0.2, type: 0.2 } as const;

export function bandFor(level: number): ConfidenceBand {
  return level < 34 ? "low" : level < 67 ? "medium" : "high";
}

// Timestamps sorted newest-first.
function descByAt(ats: readonly string[]): string[] {
  return [...ats].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

// Recency rank by distinct timestamp: newest = 100, each older step −15, floored at 40.
function recencyRanks(validAts: readonly string[]): Map<string, number> {
  const uniq = [...new Set(descByAt(validAts))];
  const m = new Map<string, number>();
  uniq.forEach((at, i) => m.set(at, Math.max(40, 100 - 15 * i)));
  return m;
}

export function computeConfidence(
  evidence: readonly QualityEvidence[],
  assessable: Record<Skill, number>,
): Record<Skill, SkillConfidence> {
  const validAll = evidence.filter((e) => e.valid);
  const rank = recencyRanks(validAll.map((e) => e.at));

  const out = {} as Record<Skill, SkillConfidence>;
  for (const skill of ALL_SKILLS) {
    const raw = evidence.filter((e) => e.skill === skill);
    const valid = raw.filter((e) => e.valid);

    const validity = raw.length > 0 ? Math.round((100 * valid.length) / raw.length) : 0;

    const denom = assessable[skill] ?? 0;
    const coverage =
      denom > 0
        ? Math.round(100 * Math.min(1, valid.length / denom))
        : valid.length > 0
          ? 100
          : 0;

    const typeReliability =
      valid.length > 0
        ? Math.round((100 * valid.reduce((s, e) => s + TYPE_WEIGHT[e.assessmentType], 0)) / valid.length)
        : 0;

    let recency = 0;
    if (valid.length > 0) {
      const newest = descByAt(valid.map((e) => e.at))[0];
      recency = rank.get(newest) ?? 0;
    }

    const level = Math.round(
      W.validity * validity + W.coverage * coverage + W.recency * recency + W.type * typeReliability,
    );
    out[skill] = {
      level,
      band: bandFor(level),
      evidenceCount: valid.length,
      quality: { validity, coverage, recency, typeReliability },
    };
  }
  return out;
}
