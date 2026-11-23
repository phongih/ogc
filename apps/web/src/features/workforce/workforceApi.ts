/*
 * Workforce screens (teacher load page, "Who has room?" hints) are shared by the demo and the
 * Platform (owner, 23/11). They call this interface, never an adapter: the demo provides its mock
 * (demoWorkforceApi.ts), the Platform its API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  Employment,
  LoadCandidate,
  WorkforceOverview,
  WorkforceResult,
  WorkforceSettings,
} from "@ogc/contracts";

export type LoadTarget = { classId: string } | { sessionId: string } | { weeklyMinutes: number };

export interface WorkforceApi {
  key: readonly unknown[];
  subtitle: string;
  back: { to: string; label: string } | null;
  Banner: ComponentType | null; // e.g. "limited by access policy"
  /** Hook: may the caller set targets / thresholds (UI hint; the server decides). */
  useCanManage(): boolean;
  getOverview(): Promise<WorkforceOverview | null>;
  setTarget(
    teacherId: string,
    employment: Employment,
    targetHours: number,
  ): Promise<WorkforceResult>;
  updateSettings(next: WorkforceSettings): Promise<WorkforceResult>;
  suggest(target: LoadTarget): Promise<LoadCandidate[] | null>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const WorkforceApiContext = createContext<WorkforceApi | null>(null);

export function useWorkforceApi(): WorkforceApi {
  const api = useContext(WorkforceApiContext);
  if (!api) throw new Error("WorkforceApiContext is not provided");
  return api;
}
