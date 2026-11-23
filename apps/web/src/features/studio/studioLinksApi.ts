/*
 * The class-course screens (which course a class follows) are shared by the demo and the Platform
 * (owner, 23/11). They call this interface, never an adapter: the demo provides its mock
 * (demoStudioLinksApi.tsx), the Platform its API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  LearnerStudioProgress,
  StudioCourse,
  StudioOverview,
  StudioResult,
} from "@ogc/contracts";

export interface StudioLinksApi {
  key: readonly unknown[];
  /** "synthetic demo" or "staging": shown in the page subtitle. */
  note: string;
  Banner: ComponentType | null;
  getOverview(): Promise<StudioOverview | null>;
  searchCourses(query: string): Promise<StudioCourse[] | null>;
  propose(classId: string, courseRef: string): Promise<StudioResult>;
  link(classId: string, courseRef: string, prepHoursPerWeek: number): Promise<StudioResult>;
  reject(linkId: string, reason: string): Promise<StudioResult>;
  unlink(linkId: string, reason: string): Promise<StudioResult>;
  setPrepHours(linkId: string, hours: number): Promise<StudioResult>;
  progress(linkId: string): Promise<LearnerStudioProgress[] | null>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const StudioLinksApiContext = createContext<StudioLinksApi | null>(null);
export function useStudioLinksApi(): StudioLinksApi {
  const api = useContext(StudioLinksApiContext);
  if (!api) throw new Error("StudioLinksApiContext is not provided");
  return api;
}
