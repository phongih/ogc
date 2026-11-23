/*
 * OGC Platform web app (ADR-040). Synthetic data, mock IIOS, staging only. Screens of slice 1:
 * dev sign-in (persona picker), Schedule for center staff, Attendance for teachers.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { ApiError } from "./client";
import { loadSession, saveSession, type PlatformSession } from "./session";
import { LoginPage } from "./pages/LoginPage";
import { SchedulePage } from "./pages/SchedulePage";
import { TeachingPage } from "./pages/TeachingPage";
import { ClassPage } from "./pages/ClassPage";
import { SessionPage } from "./pages/SessionPage";
import { AccessPage } from "./pages/AccessPage";
import { MakeupsPage } from "./pages/MakeupsPage";
import { MyMakeupsPage } from "./pages/MyMakeupsPage";
import { PlatformWorkforcePage } from "./pages/WorkforcePage";
import { PlatformAdmissionsPage } from "./pages/AdmissionsPage";
import { PlatformBillingPage, PlatformTuitionPage } from "./pages/BillingPage";
import { PlatformPartnersPage } from "./pages/PartnersPage";
import { PlatformStudentsPage } from "./pages/StudentsPage";
import { PlatformEnginePage } from "./pages/EnginePage";
import {
  PlatformClassLessonPage,
  PlatformCoursePage,
  PlatformCoursesPage,
  PlatformMyCoursesPage,
} from "./pages/CoursesPage";

interface Ctx {
  session: PlatformSession | null;
  setSession: (s: PlatformSession | null) => void;
}
const SessionCtx = createContext<Ctx>({ session: null, setSession: () => {} });
export const useSession = () => useContext(SessionCtx);
/** The signed-in session; pages under <Protected> only. */
export const useSignedIn = (): PlatformSession => {
  const s = useSession().session;
  if (!s) throw new Error("not signed in");
  return s;
};

export const homeFor = (role: string) =>
  role === "staff"
    ? "/schedule"
    : role === "teacher"
      ? "/teaching"
      : role === "learner" || role === "guardian"
        ? "/my-makeups"
        : "/none";

function Protected({ children }: { children: ReactNode }) {
  return useSession().session ? <>{children}</> : <Navigate to="/login" replace />;
}

function Shell({ children }: { children: ReactNode }) {
  const { session, setSession } = useSession();
  const nav = useNavigate();
  return (
    <div className="min-h-full bg-bg text-fg">
      <div className="border-b border-border bg-surface px-3 py-1 text-center text-xs text-muted">
        STAGING · synthetic data · mock IIOS · not for real learner data
      </div>
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <Link to={session ? homeFor(session.role) : "/login"} className="font-semibold">
          OGC Platform
        </Link>
        {session ? (
          <nav aria-label="Platform" className="flex gap-4 text-sm">
            {session.role === "staff" ? <Link to="/schedule">Schedule</Link> : null}
            {session.role === "staff" ? <Link to="/makeups">Make-ups</Link> : null}
            {session.role === "staff" ? <Link to="/workforce">Workforce</Link> : null}
            {session.role === "staff" ? <Link to="/admissions">Admissions</Link> : null}
            {session.role === "staff" ? <Link to="/billing">Billing</Link> : null}
            {session.role === "staff" ? <Link to="/partners">Partners</Link> : null}
            {session.role === "staff" || session.role === "teacher" ? (
              <Link to="/courses">Courses</Link>
            ) : null}
            {session.role === "staff" || session.role === "teacher" ? (
              <Link to="/students">Students</Link>
            ) : null}
            {session.role === "staff" ? <Link to="/engine">Engine</Link> : null}
            {session.role === "learner" || session.role === "guardian" ? (
              <Link to="/my-makeups">Make-ups</Link>
            ) : null}
            {session.role === "learner" || session.role === "guardian" ? (
              <Link to="/tuition">Tuition</Link>
            ) : null}
            {session.role === "learner" ? <Link to="/my-courses">My courses</Link> : null}
            {session.role === "teacher" ? <Link to="/teaching">Teaching</Link> : null}
            {session.orgAdmin ? <Link to="/access">Access</Link> : null}
          </nav>
        ) : null}
        {session ? (
          <div className="flex items-center gap-3 text-sm">
            <span data-testid="who">
              {session.displayName} · {session.role} · {session.orgName}
            </span>
            <button
              type="button"
              className="rounded-ogc border border-border px-3 py-1"
              onClick={() => {
                setSession(null);
                nav("/login");
              }}
            >
              Sign out
            </button>
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-5xl px-6 py-6">{children}</main>
      <footer className="px-6 pb-6 text-xs text-muted">
        OGC Platform · build {__OGC_BUILD__} · staging
      </footer>
    </div>
  );
}

export function App() {
  const [session, setSessionState] = useState<PlatformSession | null>(loadSession);
  const setSession = (s: PlatformSession | null) => {
    saveSession(s);
    setSessionState(s);
  };
  // A 401 anywhere means the grant is no longer valid (expired / revoked): sign in again.
  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) setSession(null);
  };
  const [qc] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError }),
        mutationCache: new MutationCache({ onError }),
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <SessionCtx.Provider value={{ session, setSession }}>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <Shell>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/schedule"
                element={
                  <Protected>
                    <SchedulePage />
                  </Protected>
                }
              />
              <Route
                path="/teaching"
                element={
                  <Protected>
                    <TeachingPage />
                  </Protected>
                }
              />
              <Route
                path="/classes/:id"
                element={
                  <Protected>
                    <ClassPage />
                  </Protected>
                }
              />
              <Route
                path="/sessions/:id"
                element={
                  <Protected>
                    <SessionPage />
                  </Protected>
                }
              />
              <Route
                path="/makeups"
                element={
                  <Protected>
                    <MakeupsPage />
                  </Protected>
                }
              />
              <Route
                path="/workforce"
                element={
                  <Protected>
                    <PlatformWorkforcePage />
                  </Protected>
                }
              />
              <Route
                path="/admissions"
                element={
                  <Protected>
                    <PlatformAdmissionsPage />
                  </Protected>
                }
              />
              <Route
                path="/my-makeups"
                element={
                  <Protected>
                    <MyMakeupsPage />
                  </Protected>
                }
              />
              <Route
                path="/billing"
                element={
                  <Protected>
                    <PlatformBillingPage />
                  </Protected>
                }
              />
              <Route
                path="/partners"
                element={
                  <Protected>
                    <PlatformPartnersPage />
                  </Protected>
                }
              />
              <Route
                path="/engine"
                element={
                  <Protected>
                    <PlatformEnginePage />
                  </Protected>
                }
              />
              <Route
                path="/students"
                element={
                  <Protected>
                    <PlatformStudentsPage />
                  </Protected>
                }
              />
              <Route
                path="/courses"
                element={
                  <Protected>
                    <PlatformCoursesPage />
                  </Protected>
                }
              />
              <Route
                path="/courses/:ref"
                element={
                  <Protected>
                    <PlatformCoursePage />
                  </Protected>
                }
              />
              <Route
                path="/my-courses"
                element={
                  <Protected>
                    <PlatformMyCoursesPage />
                  </Protected>
                }
              />
              <Route
                path="/my-courses/:ref/:lessonId"
                element={
                  <Protected>
                    <PlatformClassLessonPage />
                  </Protected>
                }
              />
              <Route
                path="/tuition"
                element={
                  <Protected>
                    <PlatformTuitionPage />
                  </Protected>
                }
              />
              <Route
                path="/access"
                element={
                  <Protected>
                    <AccessPage />
                  </Protected>
                }
              />
              <Route
                path="/none"
                element={
                  <Protected>
                    <p>There is no Platform screen for this role yet. The demo has them all.</p>
                  </Protected>
                }
              />
              <Route
                path="*"
                element={<Navigate to={session ? homeFor(session.role) : "/login"} replace />}
              />
            </Routes>
          </Shell>
        </BrowserRouter>
      </QueryClientProvider>
    </SessionCtx.Provider>
  );
}
