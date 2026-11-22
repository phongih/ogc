import type { PartnersResult } from "@ogc/contracts";

const REFUSAL: Record<string, string> = {
  not_staff: "Only center staff can do this.",
  not_org_admin: "Only an Org Admin can do this.",
  not_found: "Not found.",
  invalid: "Not valid",
  invalid_step: "Not at this step",
  own_step: "Not your own step",
  access_policy: "Your access policy does not allow this.",
};

export function Refused({ r }: { r: PartnersResult | undefined }) {
  if (!r || r.ok) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      {REFUSAL[r.reason] ?? r.reason}
      {r.detail ? `: ${r.detail}` : ""}
    </p>
  );
}
