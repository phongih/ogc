import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Landing } from "../routes/public/Landing";
import { MockLogin } from "../routes/app/MockLogin";
import { Shell } from "../routes/app/Shell";
import { AppHome } from "../routes/app/AppHome";
import { RequireSection } from "./RequireSection";
import { Spinner } from "../ui";
import { JoinPage } from "../routes/public/JoinPage";


/*
 * Route-level code splitting (22/11: one 704 kB bundle). Each page loads with its route; the
 * shell, login, landing and the public /join page stay in the main chunk. Mock adapters are
 * imported eagerly by main.tsx (lib/api) so the demo save is restored before any page renders.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType<never>>>, name: K) {
  return lazy(async () => ({
    default: (await load())[name] as ComponentType<Record<string, unknown>>,
  }));
}
function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Spinner label="Loading page" />}>{children}</Suspense>;
}
const OrgList = page(() => import("../features/org/OrgList"), "OrgList");
const OrgDetail = page(() => import("../features/org/OrgDetail"), "OrgDetail");
const CenterDetail = page(() => import("../features/org/CenterDetail"), "CenterDetail");
const OperationsHome = page(() => import("../features/operations/OperationsHome"), "OperationsHome");
const CenterSetupWizard = page(() => import("../features/operations/CenterSetupWizard"), "CenterSetupWizard");
const AccessHome = page(() => import("../features/access/AccessHome"), "AccessHome");
const RewardsSettingsPage = page(() => import("../features/engine/RewardsSettingsPage"), "RewardsSettingsPage");
const GrowthAdminPage = page(() => import("../features/growth/GrowthAdminPage"), "GrowthAdminPage");
const ReferralsPage = page(() => import("../features/growth/ReferralsPage"), "ReferralsPage");
const WorkforcePage = page(() => import("../features/workforce/WorkforcePage"), "WorkforcePage");
const StudentsPage = page(() => import("../features/students/StudentsPage"), "StudentsPage");
const ForecastPage = page(() => import("../features/forecast/ForecastPage"), "ForecastPage");
const AdmissionsPage = page(() => import("../features/admissions/AdmissionsPage"), "AdmissionsPage");
const BillingPage = page(() => import("../features/billing/BillingPage"), "BillingPage");
const TuitionPage = page(() => import("../features/billing/TuitionPage"), "TuitionPage");
const DecisionEnginePage = page(() => import("../features/engine/DecisionEnginePage"), "DecisionEnginePage");
const LearnerHome = page(() => import("../features/learner/LearnerHome"), "LearnerHome");
const TeacherHome = page(() => import("../features/teacher/TeacherHome"), "TeacherHome");
const ClassDetail = page(() => import("../features/teacher/ClassDetail"), "ClassDetail");
const SessionAttendancePage = page(() => import("../features/teacher/SessionAttendancePage"), "SessionAttendancePage");
const CatalogList = page(() => import("../features/catalog/CatalogList"), "CatalogList");
const CourseDetail = page(() => import("../features/catalog/CourseDetail"), "CourseDetail");
const TutorView = page(() => import("../features/tutor/TutorView"), "TutorView");
const LessonPlanEditor = page(() => import("../features/lessonplan/LessonPlanEditor"), "LessonPlanEditor");
const GuardianHome = page(() => import("../features/guardian/GuardianHome"), "GuardianHome");
const CourseLearning = page(() => import("../features/learning/CourseLearning"), "CourseLearning");
const PracticeView = page(() => import("../features/learning/practice/PracticeView"), "PracticeView");
const SpeakingStudio = page(() => import("../features/learning/speaking/SpeakingStudio"), "SpeakingStudio");

export const routes = [
  { path: "/", element: <Landing /> },
  { path: "/login", element: <MockLogin /> },
  { path: "/join", element: <JoinPage /> },
  {
    path: "/app",
    element: <Shell />,
    children: [
      { index: true, element: <AppHome /> },
      { path: "orgs", element: <RequireSection section="directory"><Lazy><OrgList /></Lazy></RequireSection> },
      { path: "orgs/:orgId", element: <RequireSection section="directory"><Lazy><OrgDetail /></Lazy></RequireSection> },
      { path: "centers/:centerId", element: <RequireSection section="directory"><Lazy><CenterDetail /></Lazy></RequireSection> },
      { path: "operations/growth", element: <RequireSection section="operations"><Lazy><GrowthAdminPage /></Lazy></RequireSection> },
      { path: "operations/workforce", element: <RequireSection section="operations"><Lazy><WorkforcePage /></Lazy></RequireSection> },
      { path: "operations/forecast", element: <RequireSection section="operations"><Lazy><ForecastPage /></Lazy></RequireSection> },
      { path: "operations/students", element: <RequireSection section="operations"><Lazy><StudentsPage back={{ to: "/app/operations", label: "Center operations" }} /></Lazy></RequireSection> },
      { path: "teaching/students", element: <RequireSection section="teaching"><Lazy><StudentsPage back={{ to: "/app/teaching", label: "Teaching" }} /></Lazy></RequireSection> },
      { path: "operations/admissions", element: <RequireSection section="operations"><Lazy><AdmissionsPage /></Lazy></RequireSection> },
      { path: "operations/billing", element: <RequireSection section="operations"><Lazy><BillingPage /></Lazy></RequireSection> },
      { path: "tuition", element: <RequireSection section="tuition"><Lazy><TuitionPage /></Lazy></RequireSection> },
      { path: "referrals", element: <RequireSection section="referrals"><Lazy><ReferralsPage /></Lazy></RequireSection> },
      { path: "operations/rewards", element: <RequireSection section="operations"><Lazy><RewardsSettingsPage /></Lazy></RequireSection> },
      { path: "operations/engine", element: <RequireSection section="operations"><Lazy><DecisionEnginePage /></Lazy></RequireSection> },
      { path: "operations/centers/new", element: <RequireSection section="operations"><Lazy><CenterSetupWizard /></Lazy></RequireSection> },
      { path: "access", element: <RequireSection section="access"><Lazy><AccessHome /></Lazy></RequireSection> },
      { path: "operations", element: <RequireSection section="operations"><Lazy><OperationsHome /></Lazy></RequireSection> },
      { path: "learning", element: <RequireSection section="learning"><Lazy><LearnerHome /></Lazy></RequireSection> },
      { path: "learning/courses/:courseId", element: <RequireSection section="learning"><Lazy><CourseLearning /></Lazy></RequireSection> },
      { path: "learning/practice/:activityId", element: <RequireSection section="learning"><Lazy><PracticeView /></Lazy></RequireSection> },
      { path: "learning/speaking/:activityId", element: <RequireSection section="learning"><Lazy><SpeakingStudio /></Lazy></RequireSection> },
      { path: "teaching", element: <RequireSection section="teaching"><Lazy><TeacherHome /></Lazy></RequireSection> },
      { path: "teaching/classes/:classId", element: <RequireSection section="teaching"><Lazy><ClassDetail /></Lazy></RequireSection> },
      { path: "teaching/classes/:classId/sessions/:sessionId", element: <RequireSection section="teaching"><Lazy><SessionAttendancePage /></Lazy></RequireSection> },
      { path: "teaching/classes/:classId/plan", element: <RequireSection section="teaching"><Lazy><LessonPlanEditor /></Lazy></RequireSection> },
      { path: "catalog", element: <RequireSection section="catalog"><Lazy><CatalogList /></Lazy></RequireSection> },
      { path: "catalog/:courseId", element: <RequireSection section="catalog"><Lazy><CourseDetail /></Lazy></RequireSection> },
      { path: "tutor", element: <RequireSection section="tutor"><Lazy><TutorView /></Lazy></RequireSection> },
      { path: "tutor/:convId", element: <RequireSection section="tutor"><Lazy><TutorView /></Lazy></RequireSection> },
      { path: "guardian", element: <RequireSection section="guardian"><Lazy><GuardianHome /></Lazy></RequireSection> },
    ],
  },
];

export const router = createBrowserRouter(routes);
