// The demo's Partner Commissions page: the shared view over the in-browser mock.
import { DemoPartnersApi } from "./demoPartnersApi";
import { PartnersView } from "./PartnersView";

export { STATUS_LABEL } from "./PartnersView";

export function PartnersPage() {
  return (
    <DemoPartnersApi>
      <PartnersView />
    </DemoPartnersApi>
  );
}
