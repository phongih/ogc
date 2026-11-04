import type { ActivityKind, Skill } from "@ogc/contracts";

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
