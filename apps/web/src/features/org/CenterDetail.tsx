import { useParams } from "react-router-dom";
import { Breadcrumbs, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useCenter, useOrganization } from "./queries";

export function CenterDetail() {
  const { centerId = "" } = useParams();
  const q = useCenter(centerId);
  const org = useOrganization(q.data?.orgId ?? "");

  if (q.isLoading) return <Spinner label="Loading center" />;
  if (q.isError) return <ErrorState message="Could not load center." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Center not found" />;

  const c = q.data;
  return (
    <section className="space-y-6">
      <Breadcrumbs
        items={[
          { label: "Organizations", to: "/app/orgs" },
          { label: org.data?.name ?? "Organization", to: `/app/orgs/${c.orgId}` },
          { label: c.name },
        ]}
      />
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
    </section>
  );
}
