/*
 * The Course Studio screens are shared by the demo and the Platform (owner, 23/11). They call this
 * interface, never an adapter: the demo provides its mock (demoCourseStudioApi.tsx), the Platform
 * its API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  AuthoredCourseDetail,
  AuthoredCourseSummary,
  AuthoringResult,
  CourseContent,
} from "@ogc/contracts";

export interface CourseStudioApi {
  key: readonly unknown[];
  /** "synthetic demo" or "staging": shown under the course title. */
  note: string;
  list(): Promise<{ courses: AuthoredCourseSummary[]; canCreate: boolean } | null>;
  get(ref: string): Promise<AuthoredCourseDetail | null>;
  create(title: string, level: string): Promise<AuthoringResult>;
  saveDraft(ref: string, content: CourseContent, baseRevision: number): Promise<AuthoringResult>;
  submit(ref: string): Promise<AuthoringResult>;
  withdraw(ref: string): Promise<AuthoringResult>;
  approve(ref: string, note: string): Promise<AuthoringResult>;
  returnForChanges(ref: string, note: string): Promise<AuthoringResult>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const CourseStudioApiContext = createContext<CourseStudioApi | null>(null);
export function useCourseStudioApi(): CourseStudioApi {
  const api = useContext(CourseStudioApiContext);
  if (!api) throw new Error("CourseStudioApiContext is not provided");
  return api;
}
