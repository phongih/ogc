import type { ActivityKind, AssessmentType, Skill } from "@ogc/contracts";
import { ALL_SKILLS, skillLabel } from "@ogc/contracts";

// ALL_SKILLS and skillLabel live in @ogc/contracts (owner 23/11); re-exported for existing imports.
export { ALL_SKILLS, skillLabel };

// Deterministic ActivityKind → Skill mapping for LI-1.
//   reading   → reading
//   exercise  → use_of_english
//   quiz      → use_of_english
//   speaking  → speaking
export const SKILL_BY_KIND: Record<ActivityKind, Skill> = {
  reading: "reading",
  exercise: "use_of_english",
  quiz: "use_of_english",
  speaking: "speaking",
};

export function skillForKind(kind: ActivityKind): Skill {
  return SKILL_BY_KIND[kind];
}

// LI-2 — assessment reliability by kind. Objective (auto-marked) is more reliable than
// subjective (speaking) in this synthetic confidence model.
export const ASSESSMENT_BY_KIND: Record<ActivityKind, AssessmentType> = {
  reading: "objective",
  exercise: "objective",
  quiz: "objective",
  speaking: "subjective",
};

export function assessmentTypeForKind(kind: ActivityKind): AssessmentType {
  return ASSESSMENT_BY_KIND[kind];
}
