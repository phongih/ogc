import { useQuery } from "@tanstack/react-query";
import { accessPolicy } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";

/** The signed-in persona's own access policy (UI hints only — the adapters enforce). */
export function useMyAccess() {
  const viewer = useViewer();
  return useQuery({
    queryKey: ["my-access", viewer],
    queryFn: () => accessPolicy.myAccess(viewer),
    enabled: !!viewer,
  });
}
