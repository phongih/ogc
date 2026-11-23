/*
 * My Learning — the OGC course linked to the learner's class (Course Studio, owner 22/11), and one
 * lesson of it. The learner stays on the version they started; they answer every quiz and
 * reflection, then complete the lesson (answers show only after completion; reflections are kept,
 * never scored). Shared by the demo (mock) and the Platform (API) through ClassCoursePlayerApi.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CourseBlock } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, PageHeader, ProgressBar, Spinner } from "../../ui";
import { LessonView, type Interaction } from "../studio/BlockView";
import { Refused } from "../studio/CourseEditorView";
import { useClassCoursePlayerApi } from "./classCoursePlayerApi";

export function MyClassCoursesView() {
  const api = useClassCoursePlayerApi();
  const q = useQuery({ queryKey: [...api.key, "mine"], queryFn: () => api.mine() });
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
                  <Link to={api.lessonPath(c.ref, l.lessonId)} className="text-brand underline">
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

export function ClassLessonView() {
  const { ref = "", lessonId = "" } = useParams();
  const api = useClassCoursePlayerApi();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...api.key, "lesson", ref, lessonId],
    queryFn: () => api.lesson(ref, lessonId),
  });
  const course = useQuery({ queryKey: [...api.key, "mine"], queryFn: () => api.mine() });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [reflections, setReflections] = useState<Record<string, string>>({});
  const done = useMutation({
    mutationFn: () => api.complete(ref, lessonId, answers, reflections),
    onSuccess: () => api.onChanged(qc),
  });
  if (q.isLoading) return <Spinner label="Loading the lesson" />;
  if (q.isError)
    return <ErrorState message="Could not load the lesson." onRetry={() => q.refetch()} />;
  if (!q.data)
    return <EmptyState title="Lesson not found" hint="It is not part of your class course." />;
  const v = q.data;
  const c = v.completed;
  const io = (b: CourseBlock): Interaction | undefined => {
    if (b.kind === "quiz")
      return c
        ? { answer: c.answers[b.id], revealed: true }
        : { answer: answers[b.id], onAnswer: (i) => setAnswers((a) => ({ ...a, [b.id]: i })) };
    if (b.kind === "reflection")
      return c
        ? { reflection: c.reflections[b.id] ?? "" }
        : {
            reflection: reflections[b.id] ?? "",
            onReflection: (t) => setReflections((r) => ({ ...r, [b.id]: t })),
          };
    return undefined;
  };
  const mine = course.data?.find((x) => x.ref === ref);
  const nextId = mine?.lessons[v.index + 1]?.lessonId;
  return (
    <section className="space-y-4">
      <PageHeader
        title={v.lesson.title}
        subtitle={`${mine?.title ?? ref} · lesson ${v.index + 1} of ${v.total} · version ${v.version}`}
      />
      <Card>
        <LessonView blocks={v.lesson.blocks} io={io} />
      </Card>
      {c ? (
        <p className="text-sm" data-testid="lesson-done">
          Lesson completed
          {c.score !== null
            ? ` · quiz ${c.score}%${api.scoreNote ? ` (${api.scoreNote})` : ""}`
            : ""}
          .
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Button onClick={() => done.mutate()} disabled={done.isPending}>
            Complete lesson
          </Button>
          <Refused r={done.data} />
        </div>
      )}
      <div className="flex gap-4 text-sm">
        <Link to={api.home.to} className="text-brand">
          ← {api.home.label}
        </Link>
        {c && nextId ? (
          <Link to={api.lessonPath(ref, nextId)} className="text-brand">
            Next lesson →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
