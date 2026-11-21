import { useMyAccess } from "./useMyAccess";

/** One line telling a restricted member that an access policy narrows what they can do here. */
export function AccessBanner() {
  const me = useMyAccess();
  if (!me.data?.policyName) return null;
  return (
    <p
      role="note"
      className="rounded-ogc border border-border bg-surface px-3 py-2 text-sm text-muted"
    >
      {me.data.failedClosed
        ? "Your access policy is unavailable, so actions here are switched off. Ask your Org Admin."
        : `Limited by access policy: ${me.data.policyName}. Ask your Org Admin if you need more.`}
    </p>
  );
}
