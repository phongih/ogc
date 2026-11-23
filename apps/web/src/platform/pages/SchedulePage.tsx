// Center schedule for staff (real API). Every change comes back as a ScheduleResult; refusals and
// clashes are shown as the API words them, and the schedule is re-read after every change.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClassSchedule, ScheduledSession, ScheduleResult, TeacherRef } from "@ogc/contracts";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { centerLocalToIso, formatCenterDateTime, isoToCenterLocal } from "../../lib/centerTime";
import { platformApi } from "../client";
import { useSignedIn } from "../App";
import { LoadHintView } from "../../features/workforce/LoadHintView";
import { PlatformWorkforceApi, PolicyBanner } from "../workforce";

export const REFUSAL_TEXT: Record<string, string> = {
  not_found: "Not found in this organization.",
  not_staff: "Only center staff can change the schedule.",
  in_past: "The new time must be in the future.",
  already_started:
    "This session has started or been marked; it can no longer be moved or cancelled.",
  cancelled: "This session is already cancelled.",
  unknown_teacher: "Unknown teacher.",
  same_teacher: "The substitute must be someone other than the class teacher.",
  clash: "The teacher is already busy at that time.",
  access_policy: "Your access policy does not allow this here.",
};

function Outcome({ r }: { r: ScheduleResult | undefined }) {
  if (!r) return null;
  if (r.ok)
    return (
      <p role="status" className="text-sm text-muted">
        Saved.
      </p>
    );
  return (
    <div role="alert" className="text-sm text-danger" data-testid="refusal">
      <p>{REFUSAL_TEXT[r.reason] ?? r.reason}</p>
      {r.clashes?.length ? (
        <ul className="list-disc pl-5">
          {r.clashes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function useChange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<ScheduleResult>) => run(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["schedule"] }),
  });
}

function SessionRow({
  cls,
  s,
  teachers,
}: {
  cls: ClassSchedule;
  s: ScheduledSession;
  teachers: TeacherRef[];
}) {
  const session = useSignedIn();
  const change = useChange();
  const [at, setAt] = useState(isoToCenterLocal(s.at));
  const [replacement, setReplacement] = useState("");
  const editable = s.state === "scheduled" && !s.started && !s.marked;
  const iso = (v: string) => centerLocalToIso(v) ?? "";
  return (
    <li className="border-t border-border py-2" data-testid={`session-${s.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{formatCenterDateTime(s.at)}</span>
        <span className="text-sm text-muted">{s.title}</span>
        {s.state === "cancelled" ? <Badge>cancelled</Badge> : null}
        {s.marked ? <Badge>marked</Badge> : s.started ? <Badge>started</Badge> : null}
        {s.kind === "makeup" ? <Badge>make-up</Badge> : null}
        {s.substitute ? <Badge>substitute: {s.substitute.name}</Badge> : null}
        {s.heldBy ? <Badge>held by {s.heldBy.name}</Badge> : null}
      </div>
      {editable ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col">
            <span className="text-muted">New time (center time)</span>
            <input
              type="datetime-local"
              aria-label={`New time for ${s.id}`}
              className="rounded-ogc border border-border px-2 py-1"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
          </label>
          <Button
            variant="ghost"
            disabled={change.isPending}
            onClick={() => change.mutate(() => platformApi.reschedule(session, s.id, iso(at)))}
          >
            Reschedule
          </Button>
          <label className="flex flex-col">
            <span className="text-muted">Replacement (required to cancel)</span>
            <input
              type="datetime-local"
              aria-label={`Replacement for ${s.id}`}
              className="rounded-ogc border border-border px-2 py-1"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
          </label>
          <Button
            variant="ghost"
            disabled={change.isPending || !replacement}
            onClick={() => change.mutate(() => platformApi.cancel(session, s.id, iso(replacement)))}
          >
            Cancel with replacement
          </Button>
          <label className="flex flex-col">
            <span className="text-muted">Substitute</span>
            <select
              aria-label={`Substitute for ${s.id}`}
              className="rounded-ogc border border-border px-2 py-1"
              value={s.substitute?.id ?? ""}
              disabled={change.isPending}
              onChange={(e) =>
                change.mutate(() =>
                  platformApi.setSubstitute(session, s.id, e.target.value || null),
                )
              }
            >
              <option value="">None</option>
              {teachers
                .filter((t) => t.id !== cls.teacher?.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      ) : null}
      {editable ? <LoadHintView target={{ sessionId: s.id }} label={s.title} /> : null}
      <Outcome r={change.data} />
    </li>
  );
}

function ClassCard({ cls, teachers }: { cls: ClassSchedule; teachers: TeacherRef[] }) {
  const session = useSignedIn();
  const teacherChange = useChange();
  const add = useChange();
  const [title, setTitle] = useState("Extra session");
  const [at, setAt] = useState("");
  return (
    <Card className="mb-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-medium">{cls.className}</h2>
          <p className="text-sm text-muted">
            {cls.centerName} · {cls.learnerCount} learners
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Class teacher</span>
          <select
            aria-label={`Teacher of ${cls.className}`}
            className="rounded-ogc border border-border px-2 py-1"
            value={cls.teacher?.id ?? ""}
            disabled={teacherChange.isPending}
            onChange={(e) =>
              e.target.value &&
              teacherChange.mutate(() =>
                platformApi.assignTeacher(session, cls.classId, e.target.value),
              )
            }
          >
            {cls.teacher ? null : <option value="">—</option>}
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LoadHintView target={{ classId: cls.classId }} label={cls.className} />
      <Outcome r={teacherChange.data} />
      <ul className="mt-2">
        {cls.sessions.map((s) => (
          <SessionRow key={s.id} cls={cls} s={s} teachers={teachers} />
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3 text-sm">
        <label className="flex flex-col">
          <span className="text-muted">Title</span>
          <input
            aria-label={`New session title for ${cls.className}`}
            className="rounded-ogc border border-border px-2 py-1"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="flex flex-col">
          <span className="text-muted">When (center time)</span>
          <input
            type="datetime-local"
            aria-label={`New session time for ${cls.className}`}
            className="rounded-ogc border border-border px-2 py-1"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </label>
        <Button
          disabled={add.isPending || !at || !title.trim()}
          onClick={() =>
            add.mutate(() =>
              platformApi.addSession(
                session,
                cls.classId,
                title.trim(),
                centerLocalToIso(at) ?? "",
              ),
            )
          }
        >
          Add session
        </Button>
      </div>
      <Outcome r={add.data} />
    </Card>
  );
}

export function SchedulePage() {
  const session = useSignedIn();
  const q = useQuery({ queryKey: ["schedule"], queryFn: () => platformApi.schedule(session) });
  if (q.isLoading) return <Spinner label="Loading schedule" />;
  if (q.isError)
    return <ErrorState message="Could not load the schedule." onRetry={() => q.refetch()} />;
  const data = q.data;
  if (!data || data.classes.length === 0)
    return (
      <EmptyState
        title="No classes in your scope."
        hint="Your access policy may narrow what you see."
      />
    );
  return (
    <section>
      <PageHeader title="Schedule" subtitle="Times are center time (Asia/Ho_Chi_Minh)." />
      <PlatformWorkforceApi>
        <div className="mb-4">
          <PolicyBanner />
        </div>
        {data.classes.map((c) => (
          <ClassCard key={c.classId} cls={c} teachers={data.teachers} />
        ))}
      </PlatformWorkforceApi>
    </section>
  );
}
