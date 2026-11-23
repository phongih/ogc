// Staff: leads handed to partner centers, tiered commissions, signals, settlements, partner
// reports, trends, activity (owner 22/11 + 23/11), on the API. A mock receivable — nothing is invoiced or paid.
import { PartnersView } from "../../features/partners/PartnersView";
import { PlatformPartnersApi } from "../partners";

export function PlatformPartnersPage() {
  return (
    <PlatformPartnersApi>
      <PartnersView />
    </PlatformPartnersApi>
  );
}
