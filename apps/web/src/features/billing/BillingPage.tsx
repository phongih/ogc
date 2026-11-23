// The demo's Billing page: the shared view over the in-browser mock.
import { BillingView } from "./BillingView";
import { DemoBillingApi } from "./demoBillingApi";

export { INVOICE_STATUS, InvoiceLines } from "./BillingView";

export function BillingPage() {
  return (
    <DemoBillingApi>
      <BillingView />
    </DemoBillingApi>
  );
}
