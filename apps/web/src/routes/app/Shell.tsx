import { Link, NavLink, Navigate, Outlet } from "react-router-dom";
import { useSession } from "../../app/session";
import { Button } from "../../ui";

const nav = [
  { to: "/app/orgs", label: "Directory", section: "directory" },
  { to: "/app/catalog", label: "Catalog", section: "catalog" },
  { to: "/app/tutor", label: "AI Tutor", section: "tutor" },
];

export function Shell() {
  const { session, signOut } = useSession();
  if (!session) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Link to="/app/orgs" className="font-semibold">
              OGC Learning
            </Link>
            <nav aria-label="Primary" className="hidden gap-1 sm:flex">
              {nav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    `rounded-ogc px-3 py-1.5 text-sm ${isActive ? "bg-brand text-brand-fg" : "text-muted hover:text-fg"}`
                  }
                >
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{session.displayName}</span>
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
