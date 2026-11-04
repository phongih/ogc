import { useQuery } from "@tanstack/react-query";
import { teacher } from "../../lib/api";
import { getClassAttendance } from "./attendance";

export const useTeacherDashboard = (personaId: string) =>
  useQuery({ queryKey: ["teacher", personaId], queryFn: () => teacher.getDashboard(personaId) });

export const useClassRoster = (classId: string) =>
  useQuery({ queryKey: ["roster", classId], queryFn: () => teacher.getClassRoster(classId) });

export const useClassAttendance = (personaId: string, classId: string) =>
  useQuery({
    queryKey: ["attendance", personaId, classId],
    queryFn: async () => getClassAttendance(personaId, classId),
    enabled: personaId.length > 0 && classId.length > 0,
  });
