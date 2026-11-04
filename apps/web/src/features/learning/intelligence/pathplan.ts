import type {
  ActivityPrerequisite,
  JustifiedRecommendation,
  LearnerProfile,
  LearningActivity,
  LearningPathStep,
  PathState,
  Skill,
  SkillConfidence,
} from "@ogc/contracts";
import { skillForKind } from "./skills";
import { recommend } from "./recommend";
import { justify } from "./justify";
import { intraPrereqs, topoOrder, validateGraph } from "./pathgraph";

/*
 * LI-3 — Pure learning-path planner. Composes the LI-1 recommender and LI-2 justifier with
 * the prerequisite graph. Prerequisites are never bypassed: the nextStep is chosen ONLY from
 * AVAILABLE (prerequisite-unblocked) activities, so mastery/confidence decide WHICH available
 * activity, not whether to jump a lock. No React, no I/O, no RNG.
 */
export interface PathPlanInput {
  profile: LearnerProfile;
  confidence: Record<Skill, SkillConfidence>;
  activities: readonly LearningActivity[]; // scoped to the learner's tenant
  edges: readonly ActivityPrerequisite[];
  completedIds: readonly string[];
  foreignActivityIds: ReadonlySet<string>;
}

export interface PathPlan {
  steps: LearningPathStep[];
  nextStep: JustifiedRecommendation;
  graph: ReturnType<typeof validateGraph>;
}

export function buildLearningPath(input: PathPlanInput): PathPlan {
  const graph = validateGraph({
    activities: input.activities,
    edges: input.edges,
    foreignActivityIds: input.foreignActivityIds,
  });
  const completed = new Set(input.completedIds);
  const prereqs = intraPrereqs({
    activities: input.activities,
    edges: input.edges,
    foreignActivityIds: input.foreignActivityIds,
  });

  // Activities that can NEVER become available (cycle/missing/cross-org/unreachable).
  const invalid = new Set(graph.issues.map((i) => i.activityId));
  const byId = new Map(input.activities.map((a) => [a.id, a] as const));

  const stateOf = (id: string): { state: PathState; blockedBy: string[] } => {
    if (completed.has(id)) return { state: "completed", blockedBy: [] };
    const required = prereqs.get(id) ?? [];
    const uncompleted = required.filter((r) => !completed.has(r));
    if (invalid.has(id)) {
      // Fail-closed: list the full edge's unmet/foreign requirements as blockers.
      const edge = input.edges.find((e) => e.activityId === id);
      const blockers = edge ? edge.requiresActivityIds.filter((r) => !completed.has(r)) : uncompleted;
      return { state: "blocked", blockedBy: blockers };
    }
    if (uncompleted.length === 0) return { state: "available", blockedBy: [] };
    return { state: "blocked", blockedBy: uncompleted };
  };

  const steps: LearningPathStep[] = topoOrder(input.activities, input.edges)
    .map((id) => byId.get(id))
    .filter((a): a is LearningActivity => a !== undefined)
    .map((a) => {
      const skill = skillForKind(a.kind);
      const { state, blockedBy } = stateOf(a.id);
      return {
        activityId: a.id,
        courseId: a.courseId,
        title: a.title,
        skill,
        state,
        masteryLevel: input.profile.skills[skill].level,
        confidenceBand: input.confidence[skill].band,
        blockedBy,
      };
    });

  // nextStep: recommend over AVAILABLE activities only, then justify with confidence.
  const availableActivities = steps
    .filter((s) => s.state === "available")
    .map((s) => byId.get(s.activityId))
    .filter((a): a is LearningActivity => a !== undefined);
  const rec = recommend(input.profile, availableActivities, input.completedIds);
  const nextStep = justify(rec, input.confidence);

  return { steps, nextStep, graph };
}
