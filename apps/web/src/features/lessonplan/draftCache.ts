import type { LessonPlanStatus } from "@ogc/contracts";

// In-memory, in-session draft autosave. NOT persisted to disk/localStorage and NOT sent
// to any backend — a plain module-level Map that lives only for the page session. It lets
// a teacher navigate away and back without losing an unsaved lesson-plan draft.
export interface DraftFields {
  title: string;
  objectivesText: string;
  activitiesText: string;
  resourcesText: string;
  assessment: string;
  status: LessonPlanStatus;
}

const cache = new Map<string, { fields: DraftFields; at: number }>();

export const draftCache = {
  get: (classId: string) => cache.get(classId),
  set: (classId: string, fields: DraftFields) => cache.set(classId, { fields, at: Date.now() }),
  clear: (classId: string) => cache.delete(classId),
};
