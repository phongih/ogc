// Single seam selecting adapters for each contract port. Swap for governed backend later.
import type { CatalogPort, LearnerPort, TeacherPort, TutorPort } from "@ogc/contracts";
import { mockCatalog } from "../adapters/mockCatalog";
import { mockLearner } from "../adapters/mockLearner";
import { mockTeacher } from "../adapters/mockTeacher";
import { mockTutor } from "../adapters/mockTutor";

export const catalog: CatalogPort = mockCatalog;
export const learner: LearnerPort = mockLearner;
export const teacher: TeacherPort = mockTeacher;
export const tutor: TutorPort = mockTutor;
export { directory } from "./directory";
