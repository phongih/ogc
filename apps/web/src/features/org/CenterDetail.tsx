import { Link, useParams } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useCenter } from "./queries";

export function CenterDetail() {
  const { centerId = "" } = useParams();
  const q = useCenter(centerId);

  if (q.isLoading) return <Spinner label="Loading center" />;
  if (q.isError) return <ErrorState message="Could not load center." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Center not found" />;

  const c = q.data;
  return (
    <section className="space-y-6">
      <PageHeader title={c.name} subtitle={`Center · ${c.city}`} />
      <Card>
        <dl className="grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Address</dt>
            <dd className="mt-1">{c.addressLine}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Rooms</dt>
            <dd className="mt-1">{c.roomCount}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted">Active courses</dt>
            <dd className="mt-1">{c.activeCourses}</dd>
          </div>
        </dl>
      </Card>
      <Link to={`/app/orgs/${c.orgId}`} className="inline-block text-sm text-brand">
        ← Back to organization
      </Link>
    </section>
  );
}
