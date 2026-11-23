// Staff: fee plans, invoices, payments, receivables (owner, 22/11 + 23/11), on the API.
// Guardians and learners who pay their own: their invoices, read-only.
import { BillingView } from "../../features/billing/BillingView";
import { TuitionView } from "../../features/billing/TuitionView";
import { PlatformBillingApi, PlatformTuitionApi } from "../billing";

export function PlatformBillingPage() {
  return (
    <PlatformBillingApi>
      <BillingView />
    </PlatformBillingApi>
  );
}

export function PlatformTuitionPage() {
  return (
    <PlatformTuitionApi>
      <TuitionView />
    </PlatformTuitionApi>
  );
}
