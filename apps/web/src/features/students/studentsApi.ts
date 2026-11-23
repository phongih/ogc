/*
 * Current Students is shared by the demo and the Platform (owner, 23/11). The screen calls this
 * interface, never an adapter: the demo provides its mock (demoStudentsApi.tsx), the Platform its API
 * client — the Platform bundle stays free of mocks.
 */
import { createContext, useContext, type ComponentType } from "react";
import type { StudentCard } from "@ogc/contracts";

export interface StudentsApi {
  key: readonly unknown[];
  /** "synthetic demo" or "staging": shown in the page subtitle. */
  note: string;
  Banner: ComponentType | null;
  list(): Promise<StudentCard[] | null>;
}

export const StudentsApiContext = createContext<StudentsApi | null>(null);
export function useStudentsApi(): StudentsApi {
  const api = useContext(StudentsApiContext);
  if (!api) throw new Error("StudentsApiContext is not provided");
  return api;
}
