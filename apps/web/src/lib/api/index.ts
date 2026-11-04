// Single seam selecting adapters for each contract port. Swap for governed backend later.
import type {
  CatalogPort,
  LearnerPort,
  TeacherPort,
  TutorPort,
  EnrollmentPort,
  LessonPlanPort,
  GuardianPort,
  LearningPort,
  ProgressViewPort,
  PlacementPort,
  LearningProfilePort,
  RecommendationPort,
  MasteryConfidencePort,
  JustifiedRecommendationPort,
} from "@ogc/contracts";
import { mockCatalog } from "../adapters/mockCatalog";
import { httpCatalog } from "../adapters/httpCatalog";
import { mockLearner } from "../adapters/mockLearner";
import { mockTeacher } from "../adapters/mockTeacher";
import { mockTutor } from "../adapters/mockTutor";
import { mockEnrollment } from "../adapters/mockEnrollment";
import { mockLessonPlan } from "../adapters/mockLessonPlan";
import { mockGuardian } from "../adapters/mockGuardian";
import { mockLearning, mockProgressView } from "../adapters/mockLearning";
import {
  mockPlacement,
  mockProfile,
  mockRecommendation,
  mockMasteryConfidence,
  mockJustifiedRecommendation,
} from "../adapters/mockProfile";

// Catalog is the only port with a real backend adapter (Slice-7). Selection is
// dev-config only: `http` uses the local Catalog backend, otherwise the mock. Default
// is the mock, so existing tests/E2E and all authenticated workflows are unchanged.
function selectCatalog(): CatalogPort {
  const g = (globalThis as unknown as { __OGC_CATALOG__?: { adapter?: string } }).__OGC_CATALOG__;
  const mode = g?.adapter ?? (import.meta.env.VITE_CATALOG_ADAPTER as string | undefined);
  return mode === "http" ? httpCatalog : mockCatalog;
}
export const catalog: CatalogPort = selectCatalog();
export const learner: LearnerPort = mockLearner;
export const teacher: TeacherPort = mockTeacher;
export const tutor: TutorPort = mockTutor;
export const enrollment: EnrollmentPort = mockEnrollment;
export const lessonPlan: LessonPlanPort = mockLessonPlan;
export const guardian: GuardianPort = mockGuardian;
export const learning: LearningPort = mockLearning;
export const progressView: ProgressViewPort = mockProgressView;
export const placement: PlacementPort = mockPlacement;
export const profile: LearningProfilePort = mockProfile;
export const recommendation: RecommendationPort = mockRecommendation;
export const masteryConfidence: MasteryConfidencePort = mockMasteryConfidence;
export const justifiedRecommendation: JustifiedRecommendationPort = mockJustifiedRecommendation;
export { directory } from "./directory";
