import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useGuardianDashboard } from "./queries";

function consentLabel(status: string): string {
  if (status === "active") return "Consent on file";
  if (status === "revoked") return "Consent revoked";
  return "No consent on file";
}

export function GuardianHome() {
  const { session } = useSession();
  const q = useGuardianDashboard(session?.personaId ?? "");

  if (q.isLoading) return <Spinner label="Loading guardian workspace" />;
  if (q.isError) return <ErrorState message="Could not load the guardian workspace." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="No guardian workspace" hint="This persona is not a guardian." />;

  const d = q.data;

  return (
    <section className="space-y-6">
      <PageHeader title="Guardian workspace" subtitle={`${d.guardianName} · synthetic data`} />

      {/*
        D-14: Guardian relationships are established by a governed backend only. There is
        deliberately NO control here to add or self-verify a link to a learner.
      */}
      <p className="rounded-ogc border border-border bg-surface px-3 py-2 text-xs text-muted">
        Linked learners are set up by your learning center. Guardians cannot add or verify a
        learner link here — this is handled by a governed process (unresolved requirement D-14).
      </p>

      {d.links.length === 0 ? (
        <EmptyState title="No linked learners" hint="Contact your center to link a learner." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {d.links.map((link) => (
            <li key={link.learnerId}>
              <Card className="space-y-2">
                <h2 className="font-medium">{link.displayName}</h2>
                <div>
                  <div
                    role="progressbar"
                    aria-valuenow={link.progressPct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${link.displayName} progress`}
                    className="h-2 w-full overflow-hidden rounded-full bg-border"
                  >
                    <span
                      className="block h-full bg-brand"
                      style={{ width: `${link.progressPct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-xs text-muted">{link.progressPct}% complete</p>
                </div>
                <p className="text-sm">{consentLabel(link.consentStatus)}</p>
                <p className="text-sm text-muted">
                  Next session:{" "}
                  {link.nextSessionAt
                    ? new Date(link.nextSessionAt).toLocaleString("en-GB", { timeZone: "UTC" })
                    : "None scheduled"}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
