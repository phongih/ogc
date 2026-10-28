import { Link, useParams } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useBrands, useCenters, useOrganization } from "./queries";

export function OrgDetail() {
  const { orgId = "" } = useParams();
  const org = useOrganization(orgId);
  const brands = useBrands(orgId);
  const centers = useCenters(orgId);

  if (org.isLoading) return <Spinner label="Loading organization" />;
  if (org.isError) return <ErrorState message="Could not load organization." onRetry={() => org.refetch()} />;
  if (!org.data) return <EmptyState title="Organization not found" />;

  return (
    <section className="space-y-8">
      <PageHeader title={org.data.name} subtitle={`Organization · /${org.data.slug}`} />

      <div>
        <h2 className="mb-3 text-lg font-medium">Brands</h2>
        {brands.isLoading ? (
          <Spinner label="Loading brands" />
        ) : brands.isError ? (
          <ErrorState message="Could not load brands." onRetry={() => brands.refetch()} />
        ) : !brands.data || brands.data.length === 0 ? (
          <EmptyState title="No brands" />
        ) : (
          <ul className="flex flex-wrap gap-2">
            {brands.data.map((b) => (
              <li key={b.id} className="rounded-ogc border border-border bg-surface px-3 py-1.5 text-sm">
                {b.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Centers</h2>
        {centers.isLoading ? (
          <Spinner label="Loading centers" />
        ) : centers.isError ? (
          <ErrorState message="Could not load centers." onRetry={() => centers.refetch()} />
        ) : !centers.data || centers.data.length === 0 ? (
          <EmptyState title="No centers" />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {centers.data.map((c) => (
              <li key={c.id}>
                <Link to={`/app/centers/${c.id}`} className="block">
                  <Card className="transition hover:border-brand">
                    <h3 className="font-medium">{c.name}</h3>
                    <p className="mt-1 text-sm text-muted">{c.city}</p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link to="/app/orgs" className="inline-block text-sm text-brand">
        ← All organizations
      </Link>
    </section>
  );
}
