import type { TeacherPort, TeacherDashboard, LearnerRow } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { classes, upcomingSessions, rosters } from "../../fixtures/teaching";

const latency = <T>(v: T, ms = 100): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export const mockTeacher: TeacherPort = {
  getDashboard: (personaId) => {
    const p = personaMap[personaId];
    if (!p || !p.teacherId) return latency(null); // fail-closed: no teacher scope for this persona
    const dashboard: TeacherDashboard = {
      teacherId: p.teacherId,
      teacherName: "Tara",
      orgId: p.orgId,
      classes,
      upcoming: upcomingSessions,
    };
    return latency(dashboard);
  },
  getClassRoster: (classId): Promise<LearnerRow[]> => latency(rosters[classId] ?? []),
};
