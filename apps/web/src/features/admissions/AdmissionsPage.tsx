// The demo's Admissions page: the shared view over the in-browser mock.
import { AdmissionsView } from "./AdmissionsView";
import { DemoAdmissionsApi } from "./demoAdmissionsApi";

export { STAGE_LABEL } from "./AdmissionsView";

export function AdmissionsPage() {
  return (
    <DemoAdmissionsApi>
      <AdmissionsView />
    </DemoAdmissionsApi>
  );
}
