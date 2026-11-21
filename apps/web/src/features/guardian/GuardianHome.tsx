import type { GuardianLinkView } from "@ogc/contracts";
import { formatCenterDateTime } from "../../lib/centerTime";
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  ProgressBar,
  ProgressRing,
  Spinner,
  StatTile,
} from "../../ui";
import { useSession } from "../../app/session";
import { useGuardianDashboard } from "./queries";
import { useLearnerProgress } from "../learning/queries";
import { MyMakeups } from "../learner/MyMakeups";

function consentLabel(status: string): string {
  if (status === "active") return "Consent on file";
  if (status === "revoked") return "Consent revoked";
  return "No consent on file";
}

// Read-only progress view for ONE linked learner. The per-course breakdown is fetched
// through the authorization-checked ProgressViewPort (fail-closed: a learner the guardian
// is not linked to resolves to null). D-14: there is no add/verify control anywhere here.
function LinkedLearnerCard({
  link,
  viewerPersonaId,
}: {
  link: GuardianLinkView;
  viewerPersonaId: string;
}) {
  const prog = useLearnerProgress(viewerPersonaId, link.learnerId);
  const summary = prog.data ?? null;
  const overall = summary?.overallPct ?? link.progressPct;

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-4">
        <ProgressRing pct={overall} label={`${link.displayName} progress`} size={64} />
        <div>
          <h2 className="font-medium">{link.displayName}</h2>
          <p className="text-xs text-muted">{overall}% overall · equal-weight average</p>
        </div>
      </div>

      <p className="text-sm">{consentLabel(link.consentStatus)}</p>
      <p className="text-sm text-muted">
        Next session:{" "}
        {link.nextSessionAt ? formatCenterDateTime(link.nextSessionAt) : "None scheduled"}
      </p>

      <MyMakeups viewer={viewerPersonaId} learnerId={link.learnerId} readOnly />

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">By course</h3>
        {prog.isLoading ? (
          <p className="text-xs text-muted">Loading course progress…</p>
        ) : !summary || summary.snapshots.length === 0 ? (
          <p className="text-xs text-muted">No course progress to show.</p>
        ) : (
          <ul className="space-y-2">
            {summary.snapshots.map((s) => (
              <li key={s.courseId} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>{s.courseTitle}</span>
                  <span className="text-muted">
                    {s.completedActivities}/{s.totalActivities} · {s.progressPct}%
                  </span>
                </div>
                <ProgressBar pct={s.progressPct} label={`${s.courseTitle} progress`} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export function GuardianHome() {
  const { session } = useSession();
  const q = useGuardianDashboard(session?.personaId ?? "");

  if (q.isLoading) return <Spinner label="Loading guardian workspace" />;
  if (q.isError)
    return (
      <ErrorState message="Could not load the guardian workspace." onRetry={() => q.refetch()} />
    );
  if (!q.data)
    return <EmptyState title="No guardian workspace" hint="This persona is not a guardian." />;

  const d = q.data;
  const avgProgress =
    d.links.length > 0
      ? Math.round(d.links.reduce((sum, l) => sum + l.progressPct, 0) / d.links.length)
      : 0;

  return (
    <section className="space-y-6">
      <PageHeader title="Guardian workspace" subtitle={`${d.guardianName} · synthetic data`} />

      {/*
        D-14: Guardian relationships are established by a governed backend only. There is
        deliberately NO control here to add or self-verify a link to a learner.
      */}
      <p className="rounded-ogc border border-border bg-surface px-3 py-2 text-xs text-muted">
        Linked learners are set up by your learning center. Guardians cannot add or verify a learner
        link here — this is handled by a governed process (unresolved requirement D-14).
      </p>

      {d.links.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Linked learners" value={d.links.length} />
          <StatTile label="Average progress" value={`${avgProgress}%`} hint="equal-weight" />
        </div>
      ) : null}

      {d.links.length === 0 ? (
        <EmptyState title="No linked learners" hint="Contact your center to link a learner." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {d.links.map((link) => (
            <li key={link.learnerId}>
              <LinkedLearnerCard link={link} viewerPersonaId={session?.personaId ?? ""} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
