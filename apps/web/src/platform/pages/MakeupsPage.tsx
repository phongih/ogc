// Staff: every missed lesson until it is made up (owner, 21/11), on the Platform API.
import { useQuery } from "@tanstack/react-query";
import { MakeupBoardView } from "../../features/makeup/MakeupBoardView";
import { ErrorState, PageHeader, Spinner } from "../../ui";
import { platformApi } from "../client";
import { useSignedIn } from "../App";
import { PlatformMakeupApi } from "../makeup";

export function MakeupsPage() {
  const s = useSignedIn();
  // the teachers a make-up session can be given to come with the schedule overview
  const q = useQuery({ queryKey: ["schedule"], queryFn: () => platformApi.schedule(s) });
  if (q.isLoading) return <Spinner label="Loading" />;
  if (q.isError || !q.data)
    return <ErrorState message="Could not load make-ups." onRetry={() => q.refetch()} />;
  return (
    <section>
      <PageHeader title="Make-ups" subtitle="No learner loses a lesson. Times are center time." />
      <PlatformMakeupApi>
        <MakeupBoardView teachers={q.data.teachers} />
      </PlatformMakeupApi>
    </section>
  );
}
