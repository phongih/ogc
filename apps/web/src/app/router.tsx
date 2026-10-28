import { createBrowserRouter } from "react-router-dom";
import { Landing } from "../routes/public/Landing";
import { MockLogin } from "../routes/app/MockLogin";
import { Shell } from "../routes/app/Shell";
import { Placeholder } from "../routes/app/Placeholder";
import { OrgList } from "../features/org/OrgList";
import { OrgDetail } from "../features/org/OrgDetail";
import { CenterDetail } from "../features/org/CenterDetail";

export const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/login", element: <MockLogin /> },
  {
    path: "/app",
    element: <Shell />,
    children: [
      { index: true, element: <OrgList /> },
      { path: "orgs", element: <OrgList /> },
      { path: "orgs/:orgId", element: <OrgDetail /> },
      { path: "centers/:centerId", element: <CenterDetail /> },
      { path: "catalog", element: <Placeholder title="Course catalog" /> },
      { path: "tutor", element: <Placeholder title="AI Tutor" /> },
    ],
  },
]);
