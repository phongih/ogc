import { Navigate } from "react-router-dom";
import { sectionsFor } from "@ogc/mock-authz";
import { useSession } from "../../app/session";
import { sectionRoute } from "../../app/nav";

// Lands each persona on the first section their role can see (fail-closed to login).
export function AppHome() {
  const { session } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  const first = sectionsFor(session)[0];
  return <Navigate to={first ? sectionRoute[first] : "/login"} replace />;
}
