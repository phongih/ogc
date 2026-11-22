/*
 * My Learning — the OGC course linked to the learner's class (Course Studio, owner 22/11). The
 * learner stays on the version they started; a lesson's quiz score feeds the skill profile.
 */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { classCourses } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { Card, ProgressBar } from "../../ui";

export function MyClassCourses() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["class-courses", viewer],
    queryFn: () => classCourses.mine(viewer),
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <section aria-label="Class courses" className="space-y-2">
      <h2 className="text-lg font-medium">Your class course</h2>
      {q.data.map((c) => {
        const next = c.lessons.find((l) => !l.completedAt) ?? null;
        return (
          <Card key={c.ref}>
            <p className="font-medium">{c.title}</p>
            <p className="text-sm text-muted">
              {c.className} · version {c.version}
              {c.latestVersion > c.version
                ? ` · a newer version (v${c.latestVersion}) exists — you continue on v${c.version}`
                : ""}
            </p>
            <div className="my-2">
              <ProgressBar pct={c.pct} label={`${c.title} progress`} />
            </div>
            <p className="text-sm">
              {c.completedLessons} of {c.lessons.length} lessons done
            </p>
            <ol className="mt-2 space-y-1 text-sm">
              {c.lessons.map((l, i) => (
                <li key={l.lessonId}>
                  <Link
                    to={`/app/learning/class-courses/${c.ref}/${l.lessonId}`}
                    className="text-brand underline"
                  >
                    {i + 1}. {l.title}
                  </Link>{" "}
                  <span className="text-muted">
                    {l.completedAt ? `✓ done${l.score !== null ? ` · quiz ${l.score}%` : ""}` : ""}
                    {next?.lessonId === l.lessonId ? "← next" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        );
      })}
    </section>
  );
}
