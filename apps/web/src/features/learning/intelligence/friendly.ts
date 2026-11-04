import type { ConfidenceBand, Skill } from "@ogc/contracts";
import { skillLabel } from "./skills";

/*
 * AUTH-026 — learner-friendly language helpers (pure). Shared by the applied-recommendation
 * adapter and the learner/teacher UI so wording stays consistent. Never emits internal ids.
 */
export function masteryWord(level: number): string {
  return level < 40 ? "Just starting" : level < 70 ? "Developing" : "Strong";
}

export function confidenceWord(band: ConfidenceBand): string {
  switch (band) {
    case "low":
      return "still getting to know your level";
    case "medium":
      return "a fair read";
    case "high":
      return "a confident read";
  }
}

export function friendlyNextReason(args: {
  source: "teacher" | "system";
  skill: Skill;
  title: string;
  reasonCode?: string;
  note?: string | null;
}): string {
  if (args.source === "teacher") {
    const base = `Your teacher suggests "${args.title}" — to focus on ${args.reasonCode ?? "your learning"}.`;
    return args.note ? `${base} ${args.note}` : base;
  }
  return `A good next step is "${args.title}" to strengthen your ${skillLabel(args.skill)}.`;
}
