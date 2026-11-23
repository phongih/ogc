// Access policies on the Platform (owner decisions 23/11): the demo's full Access page over the
// Platform API, which relays the admin's own grant to IIOS (mock). IIOS stores and decides.
import { useMemo } from "react";
import { AccessAdmin, type AccessAdminApi } from "../../features/access/AccessAdmin";
import { platformApi } from "../client";
import { useSignedIn } from "../App";

export function AccessPage() {
  const s = useSignedIn();
  const api = useMemo<AccessAdminApi>(
    () => ({
      queryKey: ["access-admin", s.principalId],
      subtitle: "staging · policies stored by the mock IIOS",
      view: () => platformApi.accessAdmin(s),
      create: (input) => platformApi.createPolicy(s, input),
      revise: (ref, v, patch) => platformApi.revisePolicy(s, ref, v, patch),
      retire: (ref, v) => platformApi.retirePolicy(s, ref, v),
      attach: (member, ref) => platformApi.attachPolicy(s, member, ref),
      // a policy change can narrow anyone's next request: re-read everything
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <AccessAdmin api={api} />;
}
