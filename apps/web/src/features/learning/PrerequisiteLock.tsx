/*
 * Hard prerequisite gate — UI side (owner decision 21/11). The learner's own LI-3 learning path
 * is the single source of truth: a step in state "blocked" lists the activities still required.
 * The adapters enforce the same rule (prerequisite_required); this only explains it clearly.
 */
import { Link } from "react-router-dom";
import { activities } from "../../fixtures/activities";
import { useLearningPath } from "../learner/queries";
import { Card } from "../../ui";

export interface ActivityLock {
  ready: boolean; // path loaded
  locked: boolean;
  requires: { id: string; title: string; courseId: string }[];
}

export function useActivityLock(personaId: string, activityId: string): ActivityLock {
  const path = useLearningPath(personaId);
  if (!path.data) return { ready: !path.isLoading, locked: false, requires: [] };
  const step = path.data.steps.find((s) => s.activityId === activityId);
  if (!step || step.state !== "blocked") return { ready: true, locked: false, requires: [] };
  return {
    ready: true,
    locked: true,
    requires: step.blockedBy.map((id) => {
      const a = activities.find((x) => x.id === id);
      return { id, title: a?.title ?? "an earlier activity", courseId: a?.courseId ?? "" };
    }),
  };
}

export function LockedNotice({ lock }: { lock: ActivityLock }) {
  return (
    <Card className="space-y-2" aria-label="Locked activity">
      <p className="font-medium" data-testid="locked-notice">
        <span aria-hidden="true">🔒 </span>Finish{" "}
        {lock.requires.map((r) => `“${r.title}”`).join(" and ")} first
      </p>
      <p className="text-sm text-muted">
        This activity opens once the activities before it are done.
      </p>
      <ul className="text-sm">
        {lock.requires.map((r) => (
          <li key={r.id}>
            <Link to={`/app/learning/courses/${r.courseId}`} className="text-brand underline">
              Go to “{r.title}”
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
