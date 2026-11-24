/*
 * My Learning's class course (Course Studio) is shared by the demo and the Platform (owner, 23/11).
 * The screens call this interface, never an adapter: the demo provides its mock
 * (demoClassCoursePlayerApi.tsx), the Platform its API client — the Platform bundle stays free of
 * mocks.
 */
import { createContext, useContext } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { AuthoringResult, MyClassCourse, MyLessonView } from "@ogc/contracts";

export interface ClassCoursePlayerApi {
  key: readonly unknown[];
  /** Where "← My Learning" goes, and the path of one lesson. */
  home: { to: string; label: string };
  lessonPath(ref: string, lessonId: string): string;
  /** What a quiz score feeds, shown after a completed lesson (null: say nothing). */
  scoreNote: string | null;
  mine(): Promise<MyClassCourse[] | null>;
  lesson(ref: string, lessonId: string): Promise<MyLessonView | null>;
  complete(
    ref: string,
    lessonId: string,
    answers: Record<string, number>,
    reflections: Record<string, string>,
    speaking: Record<string, number[]>,
    practice: Record<string, number[]>,
    missions: Record<string, string>,
  ): Promise<AuthoringResult & { score?: number | null; practiceScore?: number | null }>;
  /** Try a returned speaking rehearsal again (Platform; absent in the demo). */
  retrySpeaking?(
    ref: string,
    lessonId: string,
    blockId: string,
    choices: number[],
  ): Promise<AuthoringResult>;
  /** Send a returned Mission Box again with a new note (Platform; absent in the demo). */
  retryMission?(
    ref: string,
    lessonId: string,
    blockId: string,
    note: string,
  ): Promise<AuthoringResult>;
  onChanged(qc: QueryClient): Promise<unknown> | void;
}

export const ClassCoursePlayerApiContext = createContext<ClassCoursePlayerApi | null>(null);
export function useClassCoursePlayerApi(): ClassCoursePlayerApi {
  const api = useContext(ClassCoursePlayerApiContext);
  if (!api) throw new Error("ClassCoursePlayerApiContext is not provided");
  return api;
}
