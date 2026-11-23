// Demo: the Growth Engine for center staff over the mock adapter (shared view: GrowthAdminView).
import { DemoGrowthAdminApi } from "./demoGrowthApi";
import { GrowthAdminView } from "./GrowthAdminView";

export function GrowthAdminPage() {
  return (
    <DemoGrowthAdminApi>
      <GrowthAdminView />
    </DemoGrowthAdminApi>
  );
}
