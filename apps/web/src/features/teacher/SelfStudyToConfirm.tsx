// Demo: the shared "self-study to confirm" section over the in-browser mock (see features/makeup/).
import { useViewer } from "../../app/iiosGate";
import { MakeupApiContext } from "../makeup/makeupApi";
import { useDemoMakeupApi } from "../makeup/demoMakeupApi";
import { SelfStudyToConfirmView } from "../makeup/SelfStudyToConfirmView";

export function SelfStudyToConfirm() {
  const viewer = useViewer();
  return (
    <MakeupApiContext.Provider value={useDemoMakeupApi(viewer)}>
      <SelfStudyToConfirmView />
    </MakeupApiContext.Provider>
  );
}
