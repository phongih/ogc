/*
 * Course Studio — the courses of the org the viewer may see, and "New course" (courses:author).
 * A teacher sees their own courses plus published ones (read-only); staff see every course.
 */
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { courseStudio } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card } from "../../ui";
import { AUTHORED_STATUS, Refused } from "./CourseEditorPage";

export function CourseLibrary({ base }: { base: string }) {
  const viewer = useViewer();
  const qc = useQueryClient();
  const nav = useNavigate();
  const q = useQuery({
    queryKey: ["course-studio-list", viewer],
    queryFn: () => courseStudio.list(viewer),
  });
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState("");
  const create = useMutation({
    mutationFn: () => courseStudio.create(viewer, title, level),
    onSuccess: (r) => {
      void refreshLearningState(qc);
      if (r.ok && r.ref) nav(`${base}/${r.ref}`);
    },
  });
  if (!q.data) return null;
  const review = q.data.courses.filter((c) => c.canReview);
  return (
    <Card>
      <section aria-label="Courses" className="space-y-2 text-sm">
        <h2 className="text-lg font-medium">Courses</h2>
        {review.length ? (
          <p className="text-sm" data-testid="to-review">
            Waiting for your review: {review.map((c) => c.title).join(", ")}
          </p>
        ) : null}
        <table className="w-full" aria-label="Course list">
          <thead>
            <tr className="text-left text-muted">
              {["Course", "Owner", "Status", "Lessons", "Updated"].map((h) => (
                <th key={h} scope="col" className="py-1 pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {q.data.courses.map((c) => (
              <tr key={c.ref} className="border-t border-border">
                <td className="py-1 pr-3">
                  <Link to={`${base}/${c.ref}`} className="text-brand underline">
                    {c.title}
                  </Link>{" "}
                  <span className="text-xs text-muted">
                    {c.ref} · {c.level}
                  </span>
                </td>
                <td className="py-1 pr-3">{c.ownerName}</td>
                <td className="py-1 pr-3">
                  {AUTHORED_STATUS[c.status]}
                  {c.publishedVersion ? ` · v${c.publishedVersion}` : ""}
                  {c.canEdit ? "" : " · read only"}
                </td>
                <td className="py-1 pr-3">{c.lessons}</td>
                <td className="py-1 pr-3">{formatCenterDate(c.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.data.canCreate ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <input
              aria-label="New course title"
              placeholder="New course title"
              className="min-w-64 rounded-ogc border border-border bg-surface p-1"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              aria-label="New course level"
              placeholder="Level (A2, B1…)"
              className="w-32 rounded-ogc border border-border bg-surface p-1"
              value={level}
              maxLength={20}
              onChange={(e) => setLevel(e.target.value)}
            />
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              New course
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Your access does not include writing courses.</p>
        )}
        <Refused r={create.data} />
      </section>
    </Card>
  );
}
