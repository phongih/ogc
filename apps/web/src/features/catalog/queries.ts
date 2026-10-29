import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { CourseFilter } from "@ogc/contracts";
import { catalog } from "../../lib/api";

// Small page size so the explicit pagination contract is exercised with the synthetic
// dataset (a "Load more" affordance appears once there are more than this many).
export const CATALOG_PAGE_SIZE = 2;

export const useCourses = (orgId: string, filter?: CourseFilter) =>
  useInfiniteQuery({
    // Cache key includes org + filter → switching org or filter never reuses another
    // tenant's/filter's pages.
    queryKey: ["courses", orgId, filter ?? {}],
    queryFn: ({ pageParam }) =>
      catalog.listCourses(orgId, filter, { cursor: pageParam, limit: CATALOG_PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: orgId.length > 0,
  });

export const useCourse = (orgId: string, courseId: string) =>
  useQuery({
    // Org is part of the key: a course id is resolved only within its organization.
    queryKey: ["course", orgId, courseId],
    queryFn: () => catalog.getCourse(orgId, courseId),
    enabled: orgId.length > 0 && courseId.length > 0,
  });
