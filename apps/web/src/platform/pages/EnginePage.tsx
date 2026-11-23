// Staff: the Decision Engine — rules staff tune, events with their evidence, the action log and
// the job (owner 21/11 + 23/11), on the API; plus the staff's own in-app notifications.
import { DecisionEngineView } from "../../features/engine/DecisionEngineView";
import { EngineNotificationsView } from "../../features/engine/EngineNotificationsView";
import { PlatformEngineApi, PlatformNotificationsApi } from "../engine";

export function PlatformEnginePage() {
  return (
    <section className="space-y-4">
      <PlatformNotificationsApi>
        <EngineNotificationsView />
      </PlatformNotificationsApi>
      <PlatformEngineApi>
        <DecisionEngineView />
      </PlatformEngineApi>
    </section>
  );
}
