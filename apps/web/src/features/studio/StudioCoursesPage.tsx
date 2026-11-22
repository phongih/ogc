/*
 * Learning Studio courses (owner decisions 22/11). Teachers author courses in EduOS Learning
 * Studio; OGC keeps only a course reference per class. The class teacher proposes, center staff
 * link / reject / unlink and set weekly prep hours (they count in Workforce). Only completion
 * comes back. No EduOS code or content here. SYNTHETIC — Learning Studio is a mock.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ClassCourseLink,
  StudioCourse,
  StudioCourseStatus,
  StudioOverview,
  StudioResult,
} from "@ogc/contracts";
import { studio } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { formatCenterDate } from "../../lib/centerTime";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";

const STATUS: Record<StudioCourseStatus, string> = {
  published: "Published",
  unpublished_changes: "Published · unpublished changes",
  draft: "Draft — not published",
  archived: "Archived",
};
const REFUSAL: Record<string, string> = {
  not_allowed: "Not allowed",
  not_found: "Not found.",
  invalid: "Not valid",
  invalid_step: "Not at this step",
  access_policy: "Your access policy does not allow this.",
};

function useAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<StudioResult>) => run(),
    onSuccess: () => refreshLearningState(qc),
  });
}
function Refused({ r }: { r: StudioResult | undefined }) {
  if (!r || r.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[r.reason] ?? r.reason}
      {r.detail ? `: ${r.detail}` : ""}
    </p>
  );
}

export function StudioCoursesPage({ back }: { back: { to: string; label: string } }) {
  const viewer = useViewer();
  const q = useQuery({ queryKey: ["studio", viewer], queryFn: () => studio.getOverview(viewer) });
  if (q.isLoading) return <Spinner label="Loading Learning Studio courses" />;
  if (q.isError)
    return (
      <ErrorState message="Could not load Learning Studio courses." onRetry={() => q.refetch()} />
    );
  if (!q.data)
    return <EmptyState title="Learning Studio courses are for staff and class teachers" />;
  const o = q.data;
  return (
    <section className="space-y-4">
      <PageHeader
        title="Learning Studio courses"
        subtitle="Courses linked to classes · synthetic demo"
      />
      <p className="text-xs text-muted">
        Courses are written and reviewed in EduOS Learning Studio. OGC only keeps which course a
        class follows and shows each learner&apos;s completion (lessons done, last activity) — no
        lesson content.{" "}
        {o.role === "teacher"
          ? "Propose a course for your class; center staff link it."
          : "Class teachers propose; you link, reject or unlink, and set weekly prep hours (they count in Workforce)."}
      </p>
      <AccessBanner />
      {o.classes.length === 0 ? <EmptyState title="No classes in your view" /> : null}
      <ul className="space-y-3">
        {o.classes.map((c) => (
          <li key={c.id}>
            <ClassCard o={o} classId={c.id} />
          </li>
        ))}
      </ul>
      <Link to={back.to} className="inline-block text-sm text-brand">
        ← {back.label}
      </Link>
    </section>
  );
}

function ClassCard({ o, classId }: { o: StudioOverview; classId: string }) {
  const c = o.classes.find((x) => x.id === classId)!;
  const mine = o.links.filter((l) => l.classId === classId);
  const active = mine.find((l) => l.status === "linked") ?? null;
  const proposals = mine.filter((l) => l.status === "proposed");
  const past = mine.filter((l) => l.status === "rejected" || l.status === "unlinked");
  return (
    <Card>
      <section aria-label={`Class ${c.name}`} className="space-y-2 text-sm">
        <h2 className="font-semibold">
          {c.name}{" "}
          <span className="font-normal text-muted">
            · {c.centerName}
            {c.teacherName ? ` · ${c.teacherName}` : ""}
          </span>
        </h2>
        {active ? (
          <ActiveLink l={active} canLink={o.canLink} />
        ) : (
          <p className="text-muted">No Learning Studio course linked.</p>
        )}
        {proposals.map((p) => (
          <Proposal key={p.id} p={p} canLink={o.canLink} hasActive={!!active} />
        ))}
        <AddCourse classId={classId} className={c.name} role={o.role} hasActive={!!active} />
        {past.length ? (
          <details>
            <summary className="cursor-pointer text-xs text-muted">Earlier ({past.length})</summary>
            <ul className="mt-1 text-xs text-muted">
              {past.map((l) => (
                <li key={l.id}>
                  {l.course.title} · {l.status} by {l.decidedBy}{" "}
                  {l.decidedAt ? formatCenterDate(l.decidedAt) : ""}
                  {l.reason ? ` — ${l.reason}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
    </Card>
  );
}

function CourseLine({ course }: { course: StudioCourse }) {
  return (
    <>
      <span className="font-medium">{course.title}</span>{" "}
      <span className="text-muted">
        · {course.ref} · {course.lessons} lessons · {STATUS[course.status]} ·{" "}
        <a
          href={course.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand underline"
        >
          Open in Learning Studio ↗
        </a>
      </span>
    </>
  );
}

function ActiveLink({ l, canLink }: { l: ClassCourseLink; canLink: boolean }) {
  const viewer = useViewer();
  const act = useAction();
  const [hours, setHours] = useState(String(l.prepHoursPerWeek));
  const [reason, setReason] = useState("");
  const [show, setShow] = useState(false);
  const p = useQuery({
    queryKey: ["studio-progress", viewer, l.id],
    queryFn: () => studio.progress(viewer, l.id),
    enabled: show,
  });
  return (
    <div className="rounded-ogc border border-brand p-2" data-testid={`linked-${l.className}`}>
      <p>
        <span className="text-xs uppercase text-muted">Linked</span>{" "}
        <CourseLine course={l.course} />
      </p>
      <p className="text-xs text-muted">
        Linked by {l.decidedBy} {l.decidedAt ? formatCenterDate(l.decidedAt) : ""}
        {l.proposedBy ? ` · proposed by ${l.proposedBy}` : ""} · prep {l.prepHoursPerWeek} h / week
        {l.prepHoursPerWeek ? " (counts in Workforce)" : " (not counted)"}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setShow((x) => !x)}>
          {show ? "Hide" : "Show"} completion · {l.className}
        </Button>
        {canLink ? (
          <>
            <input
              type="number"
              step="0.5"
              min={0}
              max={10}
              aria-label={`Prep hours per week · ${l.className}`}
              className="w-20 rounded-ogc border border-border bg-surface p-1"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
            <Button
              variant="ghost"
              onClick={() => act.mutate(() => studio.setPrepHours(viewer, l.id, Number(hours)))}
            >
              Save prep hours · {l.className}
            </Button>
            <input
              aria-label={`Unlink reason · ${l.className}`}
              placeholder="Why unlink?"
              className="rounded-ogc border border-border bg-surface p-1"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="ghost"
              onClick={() => act.mutate(() => studio.unlink(viewer, l.id, reason))}
            >
              Unlink · {l.className}
            </Button>
          </>
        ) : null}
      </div>
      <Refused r={act.data} />
      {show && p.data ? (
        <table className="mt-2 w-full text-sm" aria-label={`Completion · ${l.className}`}>
          <thead>
            <tr className="text-left text-muted">
              {["Learner", "Lessons completed", "Last activity"].map((h) => (
                <th key={h} scope="col" className="py-1 pr-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.data.map((r) => (
              <tr key={r.learnerId} className="border-t border-border">
                <td className="py-1 pr-3">{r.name}</td>
                <td className="py-1 pr-3">
                  {r.completedLessons} of {r.totalLessons} ({r.pct}%)
                </td>
                <td className="py-1 pr-3">
                  {r.lastActivityAt ? formatCenterDate(r.lastActivityAt) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function Proposal({
  p,
  canLink,
  hasActive,
}: {
  p: ClassCourseLink;
  canLink: boolean;
  hasActive: boolean;
}) {
  const viewer = useViewer();
  const act = useAction();
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("0");
  return (
    <div className="rounded-ogc border border-border p-2" data-testid={`proposal-${p.course.ref}`}>
      <p>
        <span className="text-xs uppercase text-muted">Proposed</span>{" "}
        <CourseLine course={p.course} />
      </p>
      <p className="text-xs text-muted">
        by {p.proposedBy} {p.proposedAt ? formatCenterDate(p.proposedAt) : ""}
        {canLink ? "" : " · waiting for center staff"}
        {canLink && hasActive
          ? " · the class already follows a course — unlink it first to link this one"
          : ""}
      </p>
      {p.mineToDecide ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            type="number"
            step="0.5"
            min={0}
            max={10}
            aria-label={`Prep hours for ${p.course.ref}`}
            className="w-20 rounded-ogc border border-border bg-surface p-1"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <Button
            disabled={hasActive}
            onClick={() =>
              act.mutate(() => studio.link(viewer, p.classId, p.course.ref, Number(hours)))
            }
          >
            Link · {p.course.ref}
          </Button>
          <input
            aria-label={`Reject reason · ${p.course.ref}`}
            placeholder="Why not?"
            className="rounded-ogc border border-border bg-surface p-1"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button
            variant="ghost"
            onClick={() => act.mutate(() => studio.reject(viewer, p.id, reason))}
          >
            Reject · {p.course.ref}
          </Button>
        </div>
      ) : null}
      <Refused r={act.data} />
    </div>
  );
}

function AddCourse({
  classId,
  className,
  role,
  hasActive,
}: {
  classId: string;
  className: string;
  role: "staff" | "teacher";
  hasActive: boolean;
}) {
  const viewer = useViewer();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const r = useQuery({
    queryKey: ["studio-search", viewer, query],
    queryFn: () => studio.searchCourses(viewer, query),
    enabled: open,
  });
  if (role === "staff" && hasActive) return null; // one course per class: unlink first
  if (!open)
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {role === "staff" ? "Link a course" : "Propose a course"} · {className}
      </Button>
    );
  return (
    <div className="space-y-1 rounded-ogc border border-border p-2">
      <input
        aria-label={`Search Learning Studio · ${className}`}
        placeholder="Search Learning Studio courses"
        className="w-full rounded-ogc border border-border bg-surface p-1"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="space-y-1" aria-label={`Learning Studio results · ${className}`}>
        {(r.data ?? []).map((c) => (
          <li key={c.ref} className="flex flex-wrap items-center gap-2">
            <CourseLine course={c} />
            {c.linkable ? (
              <Button
                variant="ghost"
                onClick={() =>
                  act.mutate(() =>
                    role === "staff"
                      ? studio.link(viewer, classId, c.ref, 0)
                      : studio.propose(viewer, classId, c.ref),
                  )
                }
              >
                {role === "staff" ? "Link" : "Propose"} {c.ref}
              </Button>
            ) : (
              <span className="text-xs text-muted">cannot be linked — no published version</span>
            )}
          </li>
        ))}
      </ul>
      <button type="button" className="text-xs text-muted" onClick={() => setOpen(false)}>
        Close
      </button>
      <Refused r={act.data} />
    </div>
  );
}
