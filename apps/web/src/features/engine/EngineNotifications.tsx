// The demo's in-app notifications: the shared view over the mock runner.
import { EngineNotificationsView } from "./EngineNotificationsView";
import { DemoNotificationsApi } from "./demoEngineApi";

export function EngineNotifications() {
  return (
    <DemoNotificationsApi>
      <EngineNotificationsView />
    </DemoNotificationsApi>
  );
}
