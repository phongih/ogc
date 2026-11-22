/*
 * Current Students (owner decision 22/11): enrolled learners with ONE of three care levels —
 * OK / Watch / Needs support — always with the evidence behind it. No psychological labels.
 * Center staff and the learner's own class teacher see this; learners and guardians do not.
 * Recommendations are suggestions for people; nothing here acts on its own.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { AttendanceMark, CareLevel, StudentCard } from "@ogc/contracts";
import { students } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { formatCenterDate } from "../../lib/centerTime";
import { Card, EmptyState, ErrorState, PageHeader, Spinner, StatTile } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { vnd } from "../growth/format";

export const CARE_LABEL: Record<CareLevel, string> = {
  ok: "OK",
  watch: "Watch",
  support: "Needs support",
};
const CARE_STYLE: Record<CareLevel, string> = {
  ok: "border-border text-muted",
  watch: "border-brand text-brand",
  support: "border-danger text-danger",
};
const MARK: Record<AttendanceMark, { sym: string; label: string }> = {
  present: { sym: "●", label: "present" },
  late: { sym: "◐", label: "late" },
  absent: { sym: "○", label: "absent" },
};

export function StudentsPage({ back }: { back: { to: string; label: string } }) {
  const viewer = useViewer();
  const q = useQuery({ queryKey: ["students", viewer], queryFn: () => students.list(viewer) });
  const [level, setLevel] = useState<"all" | CareLevel>("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Spinner label="Loading students" />;
  if (q.isError)
    return <ErrorState message="Could not load students." onRetry={() => q.refetch()} />;
  if (!q.data)
    return <EmptyState title="Current students are for center staff and class teachers" />;
  const all = q.data;
  const count = (l: CareLevel) => all.filter((c) => c.care.level === l).length;
  const list = all.filter(
    (c) =>
      (level === "all" || c.care.level === level) &&
      c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section className="space-y-4">
      <PageHeader title="Current students" subtitle="Care level with evidence · synthetic demo" />
      <p className="text-xs text-muted">
        Three levels — OK, Watch, Needs support — each with the data behind it. No labels about how
        a learner feels. Learners and guardians do not see this page. Overdue tuition is shown for
        information and never changes the level.
      </p>
      <AccessBanner />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile
          label="Needs support"
          value={<span data-testid="count-support">{count("support")}</span>}
          hint={`of ${all.length} learners`}
        />
        <StatTile
          label="Watch"
          value={<span data-testid="count-watch">{count("watch")}</span>}
          hint={`of ${all.length} learners`}
        />
        <StatTile
          label="OK"
          value={<span data-testid="count-ok">{count("ok")}</span>}
          hint={`of ${all.length} learners`}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input
          aria-label="Search learners"
          placeholder="Search by name"
          className="rounded-ogc border border-border bg-surface p-1"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          aria-label="Care level"
          className="rounded-ogc border border-border bg-surface p-1"
          value={level}
          onChange={(e) => setLevel(e.target.value as typeof level)}
        >
          <option value="all">All levels</option>
          <option value="support">Needs support</option>
          <option value="watch">Watch</option>
          <option value="ok">OK</option>
        </select>
      </div>
      {list.length === 0 ? (
        <EmptyState title="No learners match" />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Students">
          {list.map((c) => (
            <li key={c.learnerId}>
              <StudentCardView
                card={c}
                open={open === c.learnerId}
                onToggle={() => setOpen(open === c.learnerId ? null : c.learnerId)}
              />
            </li>
          ))}
        </ul>
      )}
      <Link to={back.to} className="inline-block text-sm text-brand">
        ← {back.label}
      </Link>
    </section>
  );
}

function StudentCardView({
  card: c,
  open,
  onToggle,
}: {
  card: StudentCard;
  open: boolean;
  onToggle: () => void;
}) {
  const a = c.attendance;
  return (
    <Card className="space-y-2">
      <section aria-label={`Student ${c.name}`} className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-medium">{c.name}</h2>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs ${CARE_STYLE[c.care.level]}`}
            data-testid={`care-${c.name}`}
          >
            {CARE_LABEL[c.care.level]}
          </span>
        </div>
        <p className="text-xs text-muted">
          {c.classes
            .map((k) => `${k.name} · ${k.centerName}${k.teacherName ? ` · ${k.teacherName}` : ""}`)
            .join(" / ")}
        </p>
        <p className="text-sm">
          Attendance{" "}
          {a.pct === null ? (
            "— (nothing marked yet)"
          ) : (
            <>
              {a.present + a.late} of {a.marked} ({a.pct}%){" "}
              <span
                aria-label={`Recent: ${a.recent.map((m) => MARK[m].label).join(", ")}`}
                title="last marked sessions, oldest first"
              >
                {a.recent.map((m) => MARK[m].sym).join(" ")}
              </span>
            </>
          )}
        </p>
        <p className="text-sm text-muted">
          Progress {c.progressPct}% · last practice{" "}
          {c.lastPracticeAt ? formatCenterDate(c.lastPracticeAt) : "—"}
          {c.makeups.open
            ? ` · ${c.makeups.open} make-up${c.makeups.open === 1 ? "" : "s"} open`
            : ""}
          {c.makeups.overdue ? ` (${c.makeups.overdue} overdue)` : ""}
        </p>
        {c.studio ? (
          <p className="text-sm text-muted" data-testid={`studio-${c.name}`}>
            Class course · {c.studio.title}: {c.studio.completedLessons} of {c.studio.totalLessons}{" "}
            lessons · last activity{" "}
            {c.studio.lastActivityAt ? formatCenterDate(c.studio.lastActivityAt) : "—"}
          </p>
        ) : null}
        {c.care.evidence.length ? (
          <ul className="space-y-0.5 text-sm" aria-label={`Evidence for ${c.name}`}>
            {c.care.evidence.map((e, i) => (
              <li key={i} className={e.level === "support" ? "text-danger" : ""}>
                {e.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No signals.</p>
        )}
        {c.recommendations.length || c.tuition ? (
          <button
            type="button"
            className="text-sm text-brand underline"
            aria-expanded={open}
            onClick={onToggle}
          >
            {open ? "Hide" : "Show"} suggestions{c.tuition ? " and tuition" : ""} · {c.name}
          </button>
        ) : null}
        {open ? (
          <div className="space-y-2 border-t border-border pt-2 text-sm">
            {c.recommendations.length ? (
              <ul className="space-y-1" aria-label={`Suggestions for ${c.name}`}>
                {c.recommendations.map((r) => (
                  <li key={r.kind}>
                    {r.link ? (
                      <Link className="text-brand underline" to={r.link}>
                        {r.text}
                      </Link>
                    ) : (
                      r.text
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
            {c.tuition ? (
              <p className="text-muted" data-testid={`tuition-${c.name}`}>
                Tuition (information only): {vnd(c.tuition.balanceVnd)} to pay
                {c.tuition.overdueVnd ? `, ${vnd(c.tuition.overdueVnd)} overdue` : ""}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </Card>
  );
}
