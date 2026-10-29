import type { LessonPlanPort, LessonPlan, LessonPlanDraft } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { classes, classTeachers } from "../../fixtures/teaching";
import { lessonPlanStore } from "./store";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// Returns the teacherId of the persona IF that persona owns the given class, else null.
// Fail-closed: a persona may only edit plans for classes assigned to its own teacherId.
function ownedTeacherId(personaId: string, classId: string): string | null {
  const teacherId = personaMap[personaId]?.teacherId;
  if (!teacherId) return null;
  if (classTeachers[classId] !== teacherId) return null;
  return teacherId;
}

function validate(draft: LessonPlanDraft): string[] {
  const errors: string[] = [];
  if (draft.status === "ready") {
    if (!draft.title.trim()) errors.push("A ready plan needs a title.");
    if (draft.objectives.filter((o) => o.trim()).length < 1)
      errors.push("A ready plan needs at least one objective.");
    if (draft.activities.filter((a) => a.title.trim()).length < 1)
      errors.push("A ready plan needs at least one activity.");
    if (!draft.assessment.trim()) errors.push("A ready plan needs an assessment.");
  }
  return errors;
}

export const mockLessonPlan: LessonPlanPort = {
  listForClass: (personaId, classId) => {
    if (!ownedTeacherId(personaId, classId)) return latency<LessonPlan[]>([]); // fail-closed
    return latency(lessonPlanStore.listForClass(classId));
  },

  get: (personaId, planId) => {
    const plan = lessonPlanStore.get(planId);
    if (!plan) return latency<LessonPlan | null>(null);
    if (!ownedTeacherId(personaId, plan.classId)) return latency<LessonPlan | null>(null);
    return latency<LessonPlan | null>(plan);
  },

  save: (personaId, draft) => {
    const teacherId = ownedTeacherId(personaId, draft.classId);
    if (!teacherId)
      return latency({ saved: false, errors: ["Not authorized to edit plans for this class."] });
    const cls = classes.find((c) => c.id === draft.classId);
    if (!cls) return latency({ saved: false, errors: ["Unknown class."] });

    const errors = validate(draft);
    if (errors.length) return latency({ saved: false, errors });

    const plan: LessonPlan = {
      ...draft,
      id: draft.id || lessonPlanStore.nextId(),
      orgId: cls.orgId, // org scope derived from the class, never from the client
      teacherId, // owner is the authenticated persona's teacher, never client-supplied
    };
    lessonPlanStore.upsert(plan);
    return latency({ saved: true, errors: [] });
  },
};
