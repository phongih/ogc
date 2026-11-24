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
  const [speaking, setSpeaking] = useState<Record<string, number[]>>({});
  const [retry, setRetry] = useState<Record<string, number[]>>({});
  const [practice, setPractice] = useState<Record<string, number[]>>({});
  const [missions, setMissions] = useState<Record<string, { done: boolean; note: string }>>({});
  const [missionAgain, setMissionAgain] = useState<Record<string, string>>({});
  const done = useMutation({
    mutationFn: () => {
      // a Time Detective left untouched is answered in the order it was shown
      const all = { ...practice };
      for (const b of q.data?.lesson.blocks ?? [])
        if (b.kind === "time_detective" && !all[b.id]) all[b.id] = b.events.map((_, i) => i);
      // only the missions the learner ticked are sent: an unticked one is refused (fail-closed)
      const did: Record<string, string> = {};
      for (const [id, m] of Object.entries(missions)) if (m.done) did[id] = m.note;
      return api.complete(ref, lessonId, answers, reflections, speaking, all, did);
    },
    onSuccess: () => api.onChanged(qc),
  });
  const again = useMutation({
    mutationFn: (blockId: string) =>
      api.retrySpeaking!(ref, lessonId, blockId, retry[blockId] ?? []),
    onSuccess: async (r, blockId) => {
      if (r.ok) setRetry((x) => ({ ...x, [blockId]: [] }));
      await api.onChanged(qc);
    },
  });
  const resend = useMutation({
    mutationFn: (blockId: string) =>
      api.retryMission!(ref, lessonId, blockId, missionAgain[blockId] ?? ""),
    onSuccess: async (r, blockId) => {
      if (r.ok) setMissionAgain((x) => ({ ...x, [blockId]: "" }));
      await api.onChanged(qc);
    },
  });
  const choose = (set: typeof setSpeaking, blockId: string) => (turn: number, option: number) =>
    set((x) => {
      const next = [...(x[blockId] ?? [])];
      next[turn] = option;
      return { ...x, [blockId]: next };
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
    if (b.kind === "practice" || b.kind === "eagle_match" || b.kind === "time_detective")
      return c
        ? { practice: c.practice?.[b.id] ?? [], revealed: true }
        : {
            practice:
              practice[b.id] ?? (b.kind === "time_detective" ? b.events.map((_, i) => i) : []),
            onPractice: (x) => setPractice((p) => ({ ...p, [b.id]: x })),
          };
    // flip cards and book pages are read, not answered: interactive, with nothing to record
    if (b.kind === "vocab" || b.kind === "book_page") return {};
    if (b.kind === "mission_box") {
      const attempt = v.missions?.find((a) => a.blockId === b.id) ?? null;
      if (!c)
        return {
          mission: missions[b.id] ?? { done: false, note: "" },
          onMission: (m) => setMissions((x) => ({ ...x, [b.id]: m })),
        };
      if (attempt?.status === "returned" && api.retryMission)
        return {
          mission: { done: true, note: missionAgain[b.id] ?? "" },
          onMission: (m) => setMissionAgain((x) => ({ ...x, [b.id]: m.note })),
          missionAttempt: attempt,
        };
      return {
        mission: { done: true, note: c.missions?.[b.id] ?? attempt?.note ?? "" },
        missionAttempt: attempt,
      };
    }
    if (b.kind === "speaking") {
      const attempt = v.speaking?.find((a) => a.blockId === b.id) ?? null;
      if (!c) return { choices: speaking[b.id] ?? [], onChoose: choose(setSpeaking, b.id) };
      if (attempt?.status === "returned" && api.retrySpeaking)
        return { choices: retry[b.id] ?? [], onChoose: choose(setRetry, b.id), attempt };
      return { choices: c.speaking?.[b.id] ?? attempt?.choices ?? [], revealed: true, attempt };
    }
    return undefined;
  };
  const returned = c
    ? (v.speaking ?? []).filter((a) => a.status === "returned" && api.retrySpeaking)
    : [];
  const sendAgain = c
    ? (v.missions ?? []).filter((a) => a.status === "returned" && api.retryMission)
    : [];
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
      {returned.map((a) => (
        <div key={a.blockId} className="flex items-center gap-2">
          <Button
            onClick={() => again.mutate(a.blockId)}
            disabled={again.isPending}
            aria-label={`Send the rehearsal again (${a.blockId})`}
          >
            Send the rehearsal again
          </Button>
          <Refused r={again.data} />
        </div>
      ))}
      {sendAgain.map((a) => (
        <div key={a.blockId} className="flex items-center gap-2">
          <Button
            onClick={() => resend.mutate(a.blockId)}
            disabled={resend.isPending}
            aria-label={`Send the mission again (${a.blockId})`}
          >
            Send the mission again
          </Button>
          <Refused r={resend.data} />
        </div>
      ))}
      {c ? (
        <p className="text-sm" data-testid="lesson-done">
          Lesson completed
          {c.score !== null
            ? ` · quiz ${c.score}%${api.scoreNote ? ` (${api.scoreNote})` : ""}`
            : ""}
          {c.practiceScore !== undefined && c.practiceScore !== null
            ? ` · practice ${c.practiceScore}% (XP only, not your skill profile)`
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
