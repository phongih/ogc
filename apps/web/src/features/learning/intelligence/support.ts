import type { LearnerProfile, Skill, SkillEvidence, SupportSignal } from "@ogc/contracts";
import { normalizeEvidence, updateMastery } from "./mastery";
import { ALL_SKILLS } from "./skills";

/*
 * P1 · Needs-support signals — PURE, deterministic. No new model: it replays the SAME LI-1
 * mastery fold (seed from placement, then updateMastery one evidence at a time in canonical
 * order) and reads off what happened. Thresholds are explicit, versioned constants.
 */
export const SUPPORT_VERSION = "support-v1";
export const SUPPORT_LOW_SKILL = 60; // a skill strictly below this is flagged
export const SUPPORT_DROP = 5; // the latest evidence lowering a skill by ≥ this is flagged

export function supportSignals(
  seed: LearnerProfile,
  evidence: readonly SkillEvidence[],
  speakingReturnedCount = 0,
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
    if (d !== undefined && d <= -SUPPORT_DROP)
      out.push({
        kind: "skill_drop",
        source: "practice",
        skill,
        level: m.level,
        delta: d,
        evidenceCount: m.evidenceCount,
      });
    if (m.level < SUPPORT_LOW_SKILL)
      out.push({
        kind: "low_skill",
        source: m.evidenceCount > 0 ? "practice" : "placement",
        skill,
        level: m.level,
        evidenceCount: m.evidenceCount,
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
