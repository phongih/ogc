import type { SupportPort } from "@ogc/contracts";
import { mockSupport } from "../adapters/mockProfile";
import type { SpeakingPort } from "@ogc/contracts";
import { mockSpeaking } from "../adapters/mockSpeaking";
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
  PrerequisitePort,
  LearningPathPort,
  TeacherLearningIntelligencePort,
  AppliedRecommendationPort,
  LearnerNextActionPort,
  PracticePort,
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
  mockPrerequisite,
  mockLearningPath,
  mockTeacherIntelligence,
  mockAppliedRecommendation,
  mockLearnerNextAction,
} from "../adapters/mockProfile";
import { mockPractice } from "../adapters/mockPractice";

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
export const prerequisite: PrerequisitePort = mockPrerequisite;
export const learningPath: LearningPathPort = mockLearningPath;
export const teacherIntelligence: TeacherLearningIntelligencePort = mockTeacherIntelligence;
export const appliedRecommendation: AppliedRecommendationPort = mockAppliedRecommendation;
export const learnerNextAction: LearnerNextActionPort = mockLearnerNextAction;
export const practice: PracticePort = mockPractice;
export const speaking: SpeakingPort = mockSpeaking;
export const support: SupportPort = mockSupport;
export { directory } from "./directory";
import type { AttendancePort } from "@ogc/contracts";
import { mockAttendance } from "../adapters/mockAttendance";
export const attendance: AttendancePort = mockAttendance;
import type { SchedulePort } from "@ogc/contracts";
import { mockSchedule } from "../adapters/mockSchedule";
export const schedule: SchedulePort = mockSchedule;
import type { MakeupPort } from "@ogc/contracts";
import { mockMakeup } from "../adapters/mockMakeup";
export const makeup: MakeupPort = mockMakeup;
import type { CenterSetupPort } from "@ogc/contracts";
import { mockCenterSetup } from "../adapters/mockCenterSetup";
export const centerSetup: CenterSetupPort = mockCenterSetup;
import type { DecisionEnginePort } from "@ogc/contracts";
import { mockDecisionEngine } from "../adapters/mockDecisionEngine";
export const decisionEngine: DecisionEnginePort = mockDecisionEngine;

// Access policy — OGC-ADR-039 step 2: IIOS (mock) stores and decides policies; OGC only calls the
// admin port and reads its own granted narrowing. Mock, synthetic.
import type { IiosPolicyAdminPort, MyAccessPort } from "@ogc/contracts";
import { mockMyAccess } from "../adapters/accessPolicy";
import { mockIiosPolicyAdmin } from "../integration/mockIiosPolicy";
export const accessPolicy: MyAccessPort = mockMyAccess;
export const iiosPolicyAdmin: IiosPolicyAdminPort = mockIiosPolicyAdmin;

// Gamification — derived from learning evidence only (owner 22/11). Mock, synthetic.
import type { GamificationPort } from "@ogc/contracts";
import { mockGamification } from "../adapters/mockGamification";
export const gamification: GamificationPort = mockGamification;

// Growth Engine · referrals (owner 22/11). Mock, synthetic — no money moves.
import type {
  AdmissionsPort,
  BillingPort,
  GrowthPort,
  StudentsPort,
  WorkforcePort,
} from "@ogc/contracts";
import { mockBilling } from "../adapters/mockBilling";
import { mockAdmissions } from "../adapters/mockAdmissions";
import { mockStudents } from "../adapters/mockStudents";
import { mockWorkforce } from "../adapters/mockWorkforce";
import { mockGrowth } from "../adapters/mockGrowth";
export const growth: GrowthPort = mockGrowth;
export const billing: BillingPort = mockBilling;
export const admissions: AdmissionsPort = mockAdmissions;
export const students: StudentsPort = mockStudents;
export const workforce: WorkforcePort = mockWorkforce;

// Business Forecast (owner 22/11). Mock, synthetic history — reads only, never acts.
import type { ForecastPort } from "@ogc/contracts";
import { mockForecast } from "../adapters/mockForecast";
export const forecast: ForecastPort = mockForecast;

// Partner Commissions (owner 22/11). Mock, synthetic — a mock receivable, no money moves.
import type { PartnersPort } from "@ogc/contracts";
import { mockPartners } from "../adapters/mockPartners";
export const partners: PartnersPort = mockPartners;

// Class courses (owner 22/11). Mock — which OGC-authored course a class follows.
import type { StudioLinksPort } from "@ogc/contracts";
import { mockStudioLinks } from "../adapters/mockStudioLinks";
export const studio: StudioLinksPort = mockStudioLinks;

// Course Studio (owner 22/11). Mock — OGC authors its own courses; learners take them in My Learning.
import type { ClassCoursePlayerPort, CourseAuthoringPort } from "@ogc/contracts";
import { mockCourseAuthoring } from "../adapters/mockCourseAuthoring";
import { mockClassCoursePlayer } from "../adapters/mockClassCoursePlayer";
export const courseStudio: CourseAuthoringPort = mockCourseAuthoring;
export const classCourses: ClassCoursePlayerPort = mockClassCoursePlayer;
