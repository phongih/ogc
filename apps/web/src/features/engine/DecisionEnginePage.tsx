// The demo's Decision Engine page: the shared screens (DecisionEngineView) over the mock runner.
import { DecisionEngineView } from "./DecisionEngineView";
import { DemoEngineApi } from "./demoEngineApi";

export function DecisionEnginePage() {
  return (
    <DemoEngineApi>
      <DecisionEngineView />
    </DemoEngineApi>
  );
}
