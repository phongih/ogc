import { useQuery } from "@tanstack/react-query";
import type { CourseFilter } from "@ogc/contracts";
import { catalog } from "../../lib/api";

export const useCourses = (orgId: string, filter?: CourseFilter) =>
  useQuery({
    queryKey: ["courses", orgId, filter ?? {}],
    queryFn: () => catalog.listCourses(orgId, filter),
  });

export const useCourse = (courseId: string) =>
  useQuery({ queryKey: ["course", courseId], queryFn: () => catalog.getCourse(courseId) });
