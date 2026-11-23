// The demo's make-up API: the in-browser mock adapter with the caller's granted context.
// Demo only — the Platform never imports this file (the bundle guard would refuse it).
import { useMemo } from "react";
import type { IiosGrantedContext } from "@ogc/contracts";
import { makeup } from "../../lib/api";
import { refreshLearningState } from "../../lib/invalidate";
import type { MakeupApi } from "./makeupApi";

export function useDemoMakeupApi(viewer: IiosGrantedContext | null | undefined): MakeupApi {
  return useMemo<MakeupApi>(
    () => ({
      key: ["makeup-demo", viewer],
      getBoard: () => (viewer ? makeup.getBoard(viewer) : Promise.resolve(null)),
      listOptions: (id) => (viewer ? makeup.listOptions(viewer, id) : Promise.resolve(null)),
      book: (id, sid) => makeup.book(viewer!, id, sid),
      openMakeupSession: (id, at, tid) => makeup.openMakeupSession(viewer!, id, at, tid),
      assignSelfStudy: (id) => makeup.assignSelfStudy(viewer!, id),
      listMine: () => (viewer ? makeup.listMine(viewer) : Promise.resolve([])),
      submitSelfStudy: (id, note) => makeup.submitSelfStudy(viewer!, id, note),
      listToConfirm: () => (viewer ? makeup.listToConfirm(viewer) : Promise.resolve([])),
      confirmSelfStudy: (id) => makeup.confirmSelfStudy(viewer!, id),
      returnSelfStudy: (id, note) => makeup.returnSelfStudy(viewer!, id, note),
      onChanged: (qc) => refreshLearningState(qc),
    }),
    [viewer],
  );
}
