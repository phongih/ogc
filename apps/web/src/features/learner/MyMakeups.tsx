// Demo: the shared "my make-ups" section over the in-browser mock (see features/makeup/).
import { useViewer } from "../../app/iiosGate";
import { MakeupApiContext } from "../makeup/makeupApi";
import { useDemoMakeupApi } from "../makeup/demoMakeupApi";
import { MyMakeupsView } from "../makeup/MyMakeupsView";

export function MyMakeups(props: { readOnly?: boolean; learnerId?: string }) {
  const viewer = useViewer(); // OGC-ADR-039 step 3b: the caller is the IIOS-granted context
  return (
    <MakeupApiContext.Provider value={useDemoMakeupApi(viewer)}>
      <MyMakeupsView {...props} />
    </MakeupApiContext.Provider>
  );
}
