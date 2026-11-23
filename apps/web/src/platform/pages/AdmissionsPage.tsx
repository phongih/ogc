// Staff: one admissions pipeline with an explainable score and a funnel (owner, 22/11), on the API.
import { AdmissionsView } from "../../features/admissions/AdmissionsView";
import { PlatformAdmissionsApi } from "../admissions";

export function PlatformAdmissionsPage() {
  return (
    <PlatformAdmissionsApi>
      <AdmissionsView />
    </PlatformAdmissionsApi>
  );
}
