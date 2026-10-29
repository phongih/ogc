import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { mockCanView, type Section } from "@ogc/mock-authz";
import { useSession } from "./session";
import { EmptyState, PageHeader } from "../ui";

// Fail-closed UI gate (NOT a security control). If the mock persona cannot view
// a section, show a closed state instead of the feature.
export function RequireSection({ section, children }: { section: Section; children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  if (!mockCanView(session, section)) {
    return (
      <section>
        <PageHeader title="Not available for this persona" />
        <EmptyState
          title="This section is hidden for the current demo persona"
          hint="Mock navigation gating only — not a production security control."
        />
      </section>
    );
  }
  return <>{children}</>;
}
