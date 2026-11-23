// Demo: the shared "Who has room?" hint over the in-browser mock (see LoadHintView.tsx).
import { DemoWorkforceApi } from "./demoWorkforceApi";
import { LoadHintView } from "./LoadHintView";
import type { LoadTarget } from "./workforceApi";

export { pctText } from "./LoadHintView";

export function LoadHint(props: { target: LoadTarget; label: string }) {
  return (
    <DemoWorkforceApi>
      <LoadHintView {...props} />
    </DemoWorkforceApi>
  );
}
