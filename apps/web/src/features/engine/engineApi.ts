/*
 * The Decision Engine screens are shared by the demo and the Platform (owner, 23/11). They call
 * these interfaces, never an adapter: the demo provides its mock (demoEngineApi.tsx), the Platform
 * its API client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ActionLogEntry,
  EngineEvent,
  EngineNotification,
  JobStatus,
  Rule,
  RuleUpdate,
  RuleUpdateResult,
} from "@ogc/contracts";

export interface EngineApi {
  key: readonly unknown[];
  /** "synthetic demo" or "staging": shown in the page subtitle. */
  note: string;
  /** How the job runs, shown on the Job Status tab. */
  jobNote: string;
  Banner: ComponentType | null;
  back: { to: string; label: string } | null;
  /** UI hint from the caller's access (the server decides). */
  useAccess(): { canManage: boolean; actionsLocked: boolean };
  listRules(): Promise<Rule[] | null>;
  updateRule(ruleId: string, patch: RuleUpdate): Promise<RuleUpdateResult>;
  runNow(): Promise<JobStatus | null>;
  listEvents(): Promise<EngineEvent[]>;
  listActions(): Promise<ActionLogEntry[]>;
  getJobStatus(): Promise<JobStatus | null>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export interface NotificationsApi {
  key: readonly unknown[];
  list(): Promise<EngineNotification[]>;
  markRead(id: string | "all"): Promise<unknown>;
}

export const EngineApiContext = createContext<EngineApi | null>(null);
export function useEngineApi(): EngineApi {
  const api = useContext(EngineApiContext);
  if (!api) throw new Error("EngineApiContext is not provided");
  return api;
}
export const NotificationsApiContext = createContext<NotificationsApi | null>(null);
export function useNotificationsApi(): NotificationsApi {
  const api = useContext(NotificationsApiContext);
  if (!api) throw new Error("NotificationsApiContext is not provided");
  return api;
}
