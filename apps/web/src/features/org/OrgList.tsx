import { Link } from "react-router-dom";
import { Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useOrganizations } from "./queries";

export function OrgList() {
  const q = useOrganizations();

  return (
    <section>
      <PageHeader title="Organizations" subtitle="The tenant root. Brands and centers live beneath an organization." />
      {q.isLoading ? (
        <Spinner label="Loading organizations" />
      ) : q.isError ? (
        <ErrorState message="Could not load organizations." onRetry={() => q.refetch()} />
      ) : !q.data || q.data.length === 0 ? (
        <EmptyState title="No organizations yet" hint="Synthetic fixtures are empty." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {q.data.map((o) => (
            <li key={o.id}>
              <Link to={`/app/orgs/${o.id}`} className="block">
                <Card className="transition hover:border-brand">
                  <h2 className="font-medium">{o.name}</h2>
                  <p className="mt-1 text-sm text-muted">
                    /{o.slug} · since {new Date(o.createdAt).getFullYear()}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
