/*
 * My Learning — one lesson of the class course (Course Studio, owner 22/11). The learner answers
 * every quiz and reflection, then completes the lesson: the quiz score is assessed evidence for
 * the skill profile; reflections are kept, never scored. Answers show only after completion.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CourseBlock } from "@ogc/contracts";
import { classCourses } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { LessonView, type Interaction } from "../studio/BlockView";
import { Refused } from "../studio/CourseEditorPage";

export function ClassLessonPage() {
  const { ref = "", lessonId = "" } = useParams();
  const viewer = useViewer();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["class-lesson", viewer, ref, lessonId],
    queryFn: () => classCourses.lesson(viewer, ref, lessonId),
  });
  const course = useQuery({
    queryKey: ["class-courses", viewer],
    queryFn: () => classCourses.mine(viewer),
  });
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [reflections, setReflections] = useState<Record<string, string>>({});
  const done = useMutation({
    mutationFn: () => classCourses.complete(viewer, ref, lessonId, answers, reflections),
    onSuccess: () => refreshLearningState(qc),
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
          {c.score !== null ? ` · quiz ${c.score}% (counts in your skill profile)` : ""}.
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
        <Link to="/app/learning" className="text-brand">
          ← My Learning
        </Link>
        {c && nextId ? (
          <Link to={`/app/learning/class-courses/${ref}/${nextId}`} className="text-brand">
            Next lesson →
          </Link>
        ) : null}
      </div>
    </section>
  );
}
