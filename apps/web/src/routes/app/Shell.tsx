import { Link, NavLink, Navigate, Outlet } from "react-router-dom";
import { sectionsFor } from "@ogc/mock-authz";
import { useSession } from "../../app/session";
import { sectionLabel, sectionRoute } from "../../app/nav";
import { Button } from "../../ui";

export function Shell() {
  const { session, signOut } = useSession();
  if (!session) return <Navigate to="/login" replace />;
  const sections = sectionsFor(session);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/app" className="font-semibold">
              OGC Learning
            </Link>
            <nav aria-label="Primary" className="hidden gap-1 sm:flex">
              {sections.map((s) => (
                <NavLink
                  key={s}
                  to={sectionRoute[s]}
                  className={({ isActive }) =>
                    `rounded-ogc px-3 py-1.5 text-sm ${isActive ? "bg-brand text-brand-fg" : "text-muted hover:text-fg"}`
                  }
                >
                  {sectionLabel[s]}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">
              {session.displayName} · {session.role}
            </span>
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
