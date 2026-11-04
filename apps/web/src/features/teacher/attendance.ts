import { personaMap } from "../../fixtures/personas";
import { classTeachers, rosters } from "../../fixtures/teaching";

// Synthetic, in-memory, deterministic class attendance. Fail-closed authz: only the teacher
// persona that OWNS the class can read it (same ownership rule as the roster/lesson plans).
// Off the shared contract; demo-only, no real data.
export interface AttendanceRow {
  learnerId: string;
  displayName: string;
  present: number;
  absent: number;
  late: number;
  rate: number; // present / total, %
}

export function getClassAttendance(personaId: string, classId: string): AttendanceRow[] | null {
  const teacherId = personaMap[personaId]?.teacherId;
  if (!teacherId || classTeachers[classId] !== teacherId) return null; // fail-closed
  const roster = rosters[classId] ?? [];
  return roster.map((r) => {
    const h = [...r.learnerId].reduce((a, c) => a + c.charCodeAt(0), 0);
    const present = 8 + (h % 5); // 8–12
    const absent = h % 3; // 0–2
    const late = (h >> 2) % 3; // 0–2
    const total = present + absent + late;
    return {
      learnerId: r.learnerId,
      displayName: r.displayName,
      present,
      absent,
      late,
      rate: Math.round((present / total) * 100),
    };
  });
}
