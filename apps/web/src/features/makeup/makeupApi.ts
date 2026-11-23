/*
 * The make-up screens (staff board, a learner's / guardian's make-ups, self-study to confirm) are
 * shared by the demo and the Platform (owner, 23/11). They call this interface, never an adapter:
 * the demo provides its in-browser mock (demoMakeupApi.ts), the Platform its API client — so the
 * Platform bundle stays free of mocks.
 */
import { createContext, useContext } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  MakeupBoard,
  MakeupItem,
  MakeupItemResult,
  MakeupOption,
  MakeupResult,
} from "@ogc/contracts";

export interface MakeupApi {
  /** Query-key prefix, so two callers never share a cache entry. */
  key: readonly unknown[];
  getBoard(): Promise<MakeupBoard | null>;
  listOptions(itemId: string): Promise<MakeupOption[] | null>;
  book(itemId: string, sessionId: string): Promise<MakeupResult>;
  openMakeupSession(itemId: string, at: string, teacherId: string): Promise<MakeupResult>;
  assignSelfStudy(itemId: string): Promise<MakeupResult>;
  listMine(): Promise<MakeupItem[]>;
  submitSelfStudy(itemId: string, note: string): Promise<MakeupItemResult>;
  listToConfirm(): Promise<MakeupItem[]>;
  confirmSelfStudy(itemId: string): Promise<MakeupItemResult>;
  returnSelfStudy(itemId: string, note: string): Promise<MakeupItemResult>;
  /** After a successful change: refresh whatever depends on it. */
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const MakeupApiContext = createContext<MakeupApi | null>(null);

export function useMakeupApi(): MakeupApi {
  const api = useContext(MakeupApiContext);
  if (!api) throw new Error("MakeupApiContext is not provided");
  return api;
}
