// The demo's Current Students: the shared screen over the mock adapter (SYNTHETIC, in the browser).
import { useMemo, type ReactNode } from "react";
import { students } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { AccessBanner } from "../access/AccessBanner";
import { StudentsApiContext, type StudentsApi } from "./studentsApi";

export function DemoStudentsApi({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  const api = useMemo<StudentsApi>(
    () => ({
      key: ["students", viewer],
      note: "synthetic demo",
      Banner: AccessBanner,
      list: () => students.list(viewer),
    }),
    [viewer],
  );
  return <StudentsApiContext.Provider value={api}>{children}</StudentsApiContext.Provider>;
}
