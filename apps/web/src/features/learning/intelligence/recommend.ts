import type {
  LearnerProfile,
  LearningActivity,
  PathStep,
  Recommendation,
  Skill,
} from "@ogc/contracts";
import { ALL_SKILLS, skillForKind, skillLabel } from "./skills";

/*
 * LI-1 — Pure recommendation engine. No React, no I/O, no RNG.
 *
 * The recommendation is a function of MASTERY over the set of AVAILABLE (incomplete)
 * activities: target the weakest skill that still has an available activity. Because the
 * governing input is mastery, changing the evidence (which changes mastery) changes the
 * recommendation even when the available-activity set is held constant — the causal
 * property AUTH-021 requires us to prove.
 */

// Skills ordered weakest-first; deterministic tie-break by taxonomy order.
function skillsByMasteryAsc(profile: LearnerProfile): Skill[] {
  return [...ALL_SKILLS].sort((a, b) => {
    const d = profile.skills[a].level - profile.skills[b].level;
    if (d !== 0) return d;
    return ALL_SKILLS.indexOf(a) - ALL_SKILLS.indexOf(b);
  });
}

// Ordered learning path: weakest skill first; within a skill, activities by id asc.
// `completedActivityIds` are excluded (already practised).
export function buildPath(
  profile: LearnerProfile,
  activities: readonly LearningActivity[],
  completedActivityIds: readonly string[],
): PathStep[] {
  const done = new Set(completedActivityIds);
  const available = activities.filter((a) => !done.has(a.id));
  const steps: PathStep[] = [];
  for (const skill of skillsByMasteryAsc(profile)) {
    const acts = available
      .filter((a) => skillForKind(a.kind) === skill)
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    for (const a of acts) {
      steps.push({
        activityId: a.id,
        courseId: a.courseId,
        skill,
        masteryLevel: profile.skills[skill].level,
      });
    }
  }
  return steps;
}

export function recommend(
  profile: LearnerProfile,
  activities: readonly LearningActivity[],
  completedActivityIds: readonly string[],
): Recommendation | null {
  const path = buildPath(profile, activities, completedActivityIds);
  if (path.length === 0) return null;
  const top = path[0];
  const reason =
    `${skillLabel(top.skill)} is your lowest skill (mastery ${top.masteryLevel}) — ` +
    `practise next to improve it.`;
  return {
    activityId: top.activityId,
    courseId: top.courseId,
    skill: top.skill,
    masteryLevel: top.masteryLevel,
    reason,
  };
}
