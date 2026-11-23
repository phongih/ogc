/*
 * Access (Org Admin) in the demo: the shared page body (AccessAdmin.tsx) over the in-browser mock
 * IIOS (OGC-ADR-039 option C), with the admin's own granted context.
 */
import { useMemo } from "react";
import { iiosPolicyAdmin } from "../../lib/api";
import { useGrantedContext } from "../../app/iiosGate";
import { useSession } from "../../app/session";
import { refreshLearningState } from "../../lib/invalidate";
import { EmptyState } from "../../ui";
import { AccessAdmin, type AccessAdminApi } from "./AccessAdmin";

export function AccessHome() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  const ctx = useGrantedContext();
  const api = useMemo<AccessAdminApi | null>(
    () =>
      ctx && viewer
        ? {
            queryKey: ["access-admin", viewer],
            subtitle: "synthetic demo",
            view: () => iiosPolicyAdmin.getAdminView(ctx),
            create: (input) => iiosPolicyAdmin.createPolicy(ctx, input),
            revise: (ref, v, patch) => iiosPolicyAdmin.revisePolicy(ctx, ref, v, patch),
            retire: (ref, v) => iiosPolicyAdmin.retirePolicy(ctx, ref, v),
            attach: (member, ref) => iiosPolicyAdmin.attachPolicy(ctx, member, ref),
            onChanged: (qc) => refreshLearningState(qc),
          }
        : null,
    [ctx, viewer],
  );
  if (!api) return <EmptyState title="Access policies are for the Org Admin" />;
  return <AccessAdmin api={api} />;
}
