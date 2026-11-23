// The make-up screens on the Platform: the shared views (features/makeup) over the Platform API.
import { useMemo, type ReactNode } from "react";
import { MakeupApiContext, type MakeupApi } from "../features/makeup/makeupApi";
import { platformApi } from "./client";
import { useSignedIn } from "./App";

export function PlatformMakeupApi({ children }: { children: ReactNode }) {
  const s = useSignedIn();
  const api = useMemo<MakeupApi>(
    () => ({
      key: ["makeup", s.principalId],
      getBoard: () => platformApi.makeupBoard(s),
      listOptions: (id) => platformApi.makeupOptions(s, id),
      book: (id, sid) => platformApi.bookMakeup(s, id, sid),
      openMakeupSession: (id, at, tid) => platformApi.openMakeupSession(s, id, at, tid),
      assignSelfStudy: (id) => platformApi.assignSelfStudy(s, id),
      listMine: () => platformApi.myMakeups(s),
      submitSelfStudy: (id, note) => platformApi.submitSelfStudy(s, id, note),
      listToConfirm: () => platformApi.selfStudyToConfirm(s),
      confirmSelfStudy: (id) => platformApi.confirmSelfStudy(s, id),
      returnSelfStudy: (id, note) => platformApi.returnSelfStudy(s, id, note),
      // a make-up can add a session (schedule) or a guest (attendance): re-read everything
      onChanged: (qc) => qc.invalidateQueries(),
    }),
    [s],
  );
  return <MakeupApiContext.Provider value={api}>{children}</MakeupApiContext.Provider>;
}
