// Learners: their own make-ups (and self-study to send). Guardians: their linked learners', read-only.
import { MyMakeupsView } from "../../features/makeup/MyMakeupsView";
import { PageHeader } from "../../ui";
import { useSignedIn } from "../App";
import { PlatformMakeupApi } from "../makeup";

export function MyMakeupsPage() {
  const s = useSignedIn();
  const guardian = s.role === "guardian";
  return (
    <section>
      <PageHeader
        title={guardian ? "Make-ups · your child" : "My make-ups"}
        subtitle="Every missed lesson stays here until it is made up. Times are center time."
      />
      <PlatformMakeupApi>
        <MyMakeupsView readOnly={guardian} />
      </PlatformMakeupApi>
      <p className="mt-4 text-sm text-muted" data-testid="nothing-missed-hint">
        Nothing listed means nothing missed.
      </p>
    </section>
  );
}
