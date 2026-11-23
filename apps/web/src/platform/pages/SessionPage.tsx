// Mark attendance for one session (real API). Every learner needs a mark; a later save replaces
// the earlier one.
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import type { AttendanceMark, RecordAttendanceResult } from "@ogc/contracts";
import { Button, Card, ErrorState, PageHeader, Spinner } from "../../ui";
import { formatCenterDateTime } from "../../lib/centerTime";
import { platformApi } from "../client";
import { useSignedIn } from "../App";

const MARKS: AttendanceMark[] = ["present", "late", "absent"];
const REFUSAL: Record<string, string> = {
  not_found: "Not found.",
  not_started: "This session has not started yet.",
  incomplete: "Every learner needs a mark.",
  not_on_roster: "A learner is not on this class.",
  cancelled: "This session was cancelled.",
};

export function SessionPage() {
  const session = useSignedIn();
  const id = useParams().id ?? "";
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["session-attendance", id],
    queryFn: () => platformApi.sessionAttendance(session, id),
  });
  const [marks, setMarks] = useState<Record<string, AttendanceMark>>({});
  useEffect(() => {
    if (!q.data) return;
    const m: Record<string, AttendanceMark> = {};
    for (const r of q.data.rows) if (r.mark) m[r.learnerId] = r.mark;
    setMarks(m);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      platformApi.recordAttendance(
        session,
        id,
        Object.entries(marks).map(([learnerId, mark]) => ({ learnerId, mark })),
      ),
    onSuccess: (r: RecordAttendanceResult) => {
      if (r.ok) {
        qc.setQueryData(["session-attendance", id], r.attendance);
        void qc.invalidateQueries({ queryKey: ["to-mark"] });
      }
    },
  });
  if (q.isLoading) return <Spinner label="Loading session" />;
  if (q.isError || !q.data) return <ErrorState message="This session is not available to you." />;
  const a = q.data;
  const complete = a.rows.every((r) => marks[r.learnerId]);
  return (
    <section>
      <PageHeader
        title={a.className}
        subtitle={`${a.session.title} · ${formatCenterDateTime(a.session.at)}`}
      />
      <Card>
        <table className="w-full text-sm">
          <tbody>
            {a.rows.map((r) => (
              <tr key={r.learnerId} className="border-t border-border">
                <td className="py-2">
                  {r.displayName}
                  {r.makeupFor ? (
                    <span className="text-muted"> · make-up for {r.makeupFor}</span>
                  ) : null}
                </td>
                {MARKS.map((m) => (
                  <td key={m}>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name={`mark-${r.learnerId}`}
                        aria-label={`${r.displayName} ${m}`}
                        checked={marks[r.learnerId] === m}
                        onChange={() => setMarks((x) => ({ ...x, [r.learnerId]: m }))}
                      />
                      {m}
                    </label>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex items-center gap-3">
          <Button disabled={!complete || save.isPending} onClick={() => save.mutate()}>
            Save attendance
          </Button>
          {save.data?.ok ? (
            <span role="status" className="text-sm text-muted">
              Saved.
            </span>
          ) : null}
          {save.data && !save.data.ok ? (
            <span role="alert" className="text-sm text-danger">
              {REFUSAL[save.data.reason] ?? save.data.reason}
            </span>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
