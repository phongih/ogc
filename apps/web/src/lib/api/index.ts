// Single seam selecting adapters for each contract port. Swap for governed backend later.
import type {
  CatalogPort,
  LearnerPort,
  TeacherPort,
  TutorPort,
  EnrollmentPort,
  LessonPlanPort,
  GuardianPort,
} from "@ogc/contracts";
import { mockCatalog } from "../adapters/mockCatalog";
import { mockLearner } from "../adapters/mockLearner";
import { mockTeacher } from "../adapters/mockTeacher";
import { mockTutor } from "../adapters/mockTutor";
import { mockEnrollment } from "../adapters/mockEnrollment";
import { mockLessonPlan } from "../adapters/mockLessonPlan";
import { mockGuardian } from "../adapters/mockGuardian";

export const catalog: CatalogPort = mockCatalog;
export const learner: LearnerPort = mockLearner;
export const teacher: TeacherPort = mockTeacher;
export const tutor: TutorPort = mockTutor;
export const enrollment: EnrollmentPort = mockEnrollment;
export const lessonPlan: LessonPlanPort = mockLessonPlan;
export const guardian: GuardianPort = mockGuardian;
export { directory } from "./directory";
