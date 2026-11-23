// Staff and class teachers: Current Students — one of three care levels with the evidence behind
// it (owner 22/11 + 23/11), on the API. Learning evidence is the placement seed and class-course
// quiz scores; attendance and make-ups come from the schedule. Synthetic data.
import { useMemo } from "react";
import { StudentsView } from "../../features/students/StudentsView";
import { StudentsApiContext, type StudentsApi } from "../../features/students/studentsApi";
import { platformApi } from "../client";
import { useSignedIn } from "../App";
import { PolicyBanner } from "../workforce";

export function PlatformStudentsPage() {
  const s = useSignedIn();
  const api = useMemo<StudentsApi>(
    () => ({
      key: ["students", s.principalId],
      note: "staging",
      Banner: PolicyBanner,
      list: () => platformApi.students(s),
    }),
    [s],
  );
  return (
    <StudentsApiContext.Provider value={api}>
      <StudentsView back={null} />
    </StudentsApiContext.Provider>
  );
}
