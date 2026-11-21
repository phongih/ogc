import { useQuery } from "@tanstack/react-query";
import { accessPolicy } from "../../lib/api";
import { useSession } from "../../app/session";

/** The signed-in persona's own access policy (UI hints only — the adapters enforce). */
export function useMyAccess() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  return useQuery({
    queryKey: ["my-access", viewer],
    queryFn: () => accessPolicy.myAccess(viewer),
    enabled: !!viewer,
  });
}
