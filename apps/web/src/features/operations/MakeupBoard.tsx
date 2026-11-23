// Demo: the shared make-up board over the in-browser mock (see features/makeup/).
import type { IiosGrantedContext, TeacherRef } from "@ogc/contracts";
import { MakeupApiContext } from "../makeup/makeupApi";
import { useDemoMakeupApi } from "../makeup/demoMakeupApi";
import { MakeupBoardView } from "../makeup/MakeupBoardView";

export function MakeupBoard({
  viewer,
  teachers,
}: {
  viewer: IiosGrantedContext;
  teachers: TeacherRef[];
}) {
  return (
    <MakeupApiContext.Provider value={useDemoMakeupApi(viewer)}>
      <MakeupBoardView teachers={teachers} />
    </MakeupApiContext.Provider>
  );
}
