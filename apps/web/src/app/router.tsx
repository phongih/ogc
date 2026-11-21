import { createBrowserRouter } from "react-router-dom";
import { Landing } from "../routes/public/Landing";
import { MockLogin } from "../routes/app/MockLogin";
import { Shell } from "../routes/app/Shell";
import { AppHome } from "../routes/app/AppHome";
import { RequireSection } from "./RequireSection";
import { OrgList } from "../features/org/OrgList";
import { OrgDetail } from "../features/org/OrgDetail";
import { CenterDetail } from "../features/org/CenterDetail";
import { OperationsHome } from "../features/operations/OperationsHome";
import { CenterSetupWizard } from "../features/operations/CenterSetupWizard";
import { DecisionEnginePage } from "../features/engine/DecisionEnginePage";
import { LearnerHome } from "../features/learner/LearnerHome";
import { TeacherHome } from "../features/teacher/TeacherHome";
import { ClassDetail } from "../features/teacher/ClassDetail";
import { SessionAttendancePage } from "../features/teacher/SessionAttendancePage";
import { CatalogList } from "../features/catalog/CatalogList";
import { CourseDetail } from "../features/catalog/CourseDetail";
import { TutorView } from "../features/tutor/TutorView";
import { LessonPlanEditor } from "../features/lessonplan/LessonPlanEditor";
import { GuardianHome } from "../features/guardian/GuardianHome";
import { CourseLearning } from "../features/learning/CourseLearning";
import { PracticeView } from "../features/learning/practice/PracticeView";
import { SpeakingStudio } from "../features/learning/speaking/SpeakingStudio";

export const routes = [
  { path: "/", element: <Landing /> },
  { path: "/login", element: <MockLogin /> },
  {
    path: "/app",
    element: <Shell />,
    children: [
      { index: true, element: <AppHome /> },
      { path: "orgs", element: <RequireSection section="directory"><OrgList /></RequireSection> },
      { path: "orgs/:orgId", element: <RequireSection section="directory"><OrgDetail /></RequireSection> },
      { path: "centers/:centerId", element: <RequireSection section="directory"><CenterDetail /></RequireSection> },
      { path: "operations/engine", element: <RequireSection section="operations"><DecisionEnginePage /></RequireSection> },
      { path: "operations/centers/new", element: <RequireSection section="operations"><CenterSetupWizard /></RequireSection> },
      { path: "operations", element: <RequireSection section="operations"><OperationsHome /></RequireSection> },
      { path: "learning", element: <RequireSection section="learning"><LearnerHome /></RequireSection> },
      { path: "learning/courses/:courseId", element: <RequireSection section="learning"><CourseLearning /></RequireSection> },
      { path: "learning/practice/:activityId", element: <RequireSection section="learning"><PracticeView /></RequireSection> },
      { path: "learning/speaking/:activityId", element: <RequireSection section="learning"><SpeakingStudio /></RequireSection> },
      { path: "teaching", element: <RequireSection section="teaching"><TeacherHome /></RequireSection> },
      { path: "teaching/classes/:classId", element: <RequireSection section="teaching"><ClassDetail /></RequireSection> },
      { path: "teaching/classes/:classId/sessions/:sessionId", element: <RequireSection section="teaching"><SessionAttendancePage /></RequireSection> },
      { path: "teaching/classes/:classId/plan", element: <RequireSection section="teaching"><LessonPlanEditor /></RequireSection> },
      { path: "catalog", element: <RequireSection section="catalog"><CatalogList /></RequireSection> },
      { path: "catalog/:courseId", element: <RequireSection section="catalog"><CourseDetail /></RequireSection> },
      { path: "tutor", element: <RequireSection section="tutor"><TutorView /></RequireSection> },
      { path: "tutor/:convId", element: <RequireSection section="tutor"><TutorView /></RequireSection> },
      { path: "guardian", element: <RequireSection section="guardian"><GuardianHome /></RequireSection> },
    ],
  },
];

export const router = createBrowserRouter(routes);
