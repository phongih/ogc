import { EmptyState, PageHeader } from "../../ui";

// Slice-1 placeholders for nav targets that arrive in later slices (catalog, tutor, workspaces).
export function Placeholder({ title }: { title: string }) {
  return (
    <section>
      <PageHeader title={title} />
      <EmptyState title="Coming in a later slice" hint="Slice-1 covers the Organization → Brand → Center directory." />
    </section>
  );
}
