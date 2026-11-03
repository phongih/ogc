import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { Activity, LessonPlanDraft, LessonPlanStatus } from "@ogc/contracts";
import { Button, Card, EmptyState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { usePlansForClass, useSavePlan } from "./queries";
import { draftCache } from "./draftCache";

// Parse a textarea (one item per line) into a trimmed, non-empty string list.
const lines = (s: string): string[] =>
  s.split("\n").map((x) => x.trim()).filter((x) => x.length > 0);

// Activities: "Title | minutes" per line.
function parseActivities(s: string): Activity[] {
  return lines(s).map((ln) => {
    const [title, mins] = ln.split("|");
    const durationMin = Math.max(0, Math.trunc(Number((mins ?? "").trim())) || 0);
    return { title: (title ?? "").trim(), durationMin };
  });
}

export function LessonPlanEditor() {
  const { session } = useSession();
  const personaId = session?.personaId ?? "";
  const { classId = "" } = useParams();
  const plans = usePlansForClass(personaId, classId);
  const save = useSavePlan(personaId, classId);

  const cached = draftCache.get(classId)?.fields;
  const [title, setTitle] = useState(cached?.title ?? "");
  const [objectivesText, setObjectivesText] = useState(cached?.objectivesText ?? "");
  const [activitiesText, setActivitiesText] = useState(cached?.activitiesText ?? "");
  const [resourcesText, setResourcesText] = useState(cached?.resourcesText ?? "");
  const [assessment, setAssessment] = useState(cached?.assessment ?? "");
  const [status, setStatus] = useState<LessonPlanStatus>(cached?.status ?? "draft");
  const [autosaved, setAutosaved] = useState<boolean>(() => Boolean(draftCache.get(classId)));

  // Autosave the working draft into an in-session cache (no disk, no backend) so it
  // survives navigation away and back. Skips an untouched empty form.
  useEffect(() => {
    const hasContent =
      Boolean(title || objectivesText || activitiesText || resourcesText || assessment) ||
      status !== "draft";
    if (!hasContent) return;
    draftCache.set(classId, { title, objectivesText, activitiesText, resourcesText, assessment, status });
    setAutosaved(true);
  }, [classId, title, objectivesText, activitiesText, resourcesText, assessment, status]);

  const draft: LessonPlanDraft = useMemo(
    () => ({
      id: "",
      classId,
      title: title.trim(),
      objectives: lines(objectivesText),
      activities: parseActivities(activitiesText),
      resources: lines(resourcesText),
      assessment: assessment.trim(),
      status,
    }),
    [classId, title, objectivesText, activitiesText, resourcesText, assessment, status],
  );

  const totalDuration = draft.activities.reduce((sum, a) => sum + a.durationMin, 0);
  const errors = save.data && !save.data.saved ? save.data.errors : [];
  const saved = save.data?.saved === true;

  return (
    <section className="space-y-6">
      <PageHeader title="Lesson plan editor" subtitle="Draft → Ready workflow · synthetic, in-memory only" />

      {plans.isLoading ? (
        <Spinner label="Loading plans" />
      ) : (
        <>
          <Card className="space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Lesson plan title"
                className="w-full rounded-ogc border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Objectives (one per line)</span>
              <textarea
                value={objectivesText}
                onChange={(e) => setObjectivesText(e.target.value)}
                aria-label="Objectives"
                rows={3}
                className="w-full rounded-ogc border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Activities (Title | minutes, one per line)</span>
              <textarea
                value={activitiesText}
                onChange={(e) => setActivitiesText(e.target.value)}
                aria-label="Activities"
                rows={3}
                className="w-full rounded-ogc border border-border bg-surface px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-muted">Total duration: {totalDuration} min</span>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Resources (one per line)</span>
              <textarea
                value={resourcesText}
                onChange={(e) => setResourcesText(e.target.value)}
                aria-label="Resources"
                rows={2}
                className="w-full rounded-ogc border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Assessment</span>
              <input
                value={assessment}
                onChange={(e) => setAssessment(e.target.value)}
                aria-label="Assessment"
                className="w-full rounded-ogc border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>

            <fieldset className="text-sm">
              <legend className="mb-1 font-medium">Status</legend>
              <label className="mr-4 inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="status"
                  checked={status === "draft"}
                  onChange={() => setStatus("draft")}
                />
                Draft
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="status"
                  checked={status === "ready"}
                  onChange={() => setStatus("ready")}
                />
                Ready
              </label>
            </fieldset>

            {errors.length > 0 ? (
              <ul role="alert" className="list-inside list-disc space-y-1 text-sm text-danger">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
            {saved ? <p className="text-sm text-brand">Lesson plan saved.</p> : null}
            {autosaved ? (
              <p className="text-xs text-muted" aria-live="polite">
                Draft autosaved in this session.
              </p>
            ) : null}

            <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save plan"}
            </Button>
          </Card>

          <section aria-label="Saved plans">
            <h2 className="mb-2 text-lg font-medium">Saved plans for this class</h2>
            {(plans.data ?? []).length === 0 ? (
              <EmptyState title="No plans saved yet" />
            ) : (
              <ul className="space-y-2">
                {(plans.data ?? []).map((p) => (
                  <li key={p.id}>
                    <Card className="flex items-center justify-between">
                      <span className="text-sm">{p.title || "(untitled)"}</span>
                      <span className="text-xs uppercase tracking-wide text-muted">{p.status}</span>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Link to={`/app/teaching/classes/${classId}`} className="inline-block text-sm text-brand">
        ← Back to class
      </Link>
    </section>
  );
}
