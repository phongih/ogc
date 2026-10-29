import { useQuery } from "@tanstack/react-query";
import { teacher } from "../../lib/api";

export const useTeacherDashboard = (personaId: string) =>
  useQuery({ queryKey: ["teacher", personaId], queryFn: () => teacher.getDashboard(personaId) });

export const useClassRoster = (classId: string) =>
  useQuery({ queryKey: ["roster", classId], queryFn: () => teacher.getClassRoster(classId) });
