import type { ActivityKind, AssessmentType, Skill } from "@ogc/contracts";

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

// Canonical skill order — the single source of iteration + tie-break order.
export const ALL_SKILLS: readonly Skill[] = ["reading", "use_of_english", "speaking"] as const;

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
