import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation } from "react-router-dom";
import { sectionsFor } from "@ogc/mock-authz";
import { useSession } from "../../app/session";
import { sectionLabel, sectionRoute } from "../../app/nav";
import { KeyboardHelp } from "../../app/KeyboardHelp";
import { ThemeToggle } from "../../app/ThemeToggle";
import { RequireIiosContext } from "../../app/iiosGate";
import { Button } from "../../ui";
import { resetDemoAndReload } from "../../lib/adapters/persist";

// Demo data is kept in this browser (persist.ts). Two-step reset, no browser dialog.
function DemoDataReset() {
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <span>
        · demo data is saved in this browser ·{" "}
        <button type="button" className="text-brand underline" onClick={() => setConfirming(true)}>
          Reset demo data
        </button>
      </span>
    );
  return (
    <span role="group" aria-label="Reset demo data">
      Clear every change and start from the original demo data?{" "}
      <button type="button" className="text-danger underline" onClick={resetDemoAndReload}>
        Yes, reset
      </button>{" "}
      <button type="button" className="underline" onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  );
}

export function Shell() {
  const { session, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const location = useLocation();

  // Focus trap: keep Tab / Shift+Tab inside the open drawer (containment), so focus
  // never reaches the background while the drawer is open.
  const trapTab = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !drawerRef.current) return;
    const nodes = drawerRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Close the drawer whenever the route changes (route selection closes the menu).
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // When the drawer opens, move focus into it; on Escape, close and restore focus.
  useEffect(() => {
    if (!menuOpen) return;
    firstLinkRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Lock background scroll while the mobile drawer is open (prevents the page behind
  // the overlay from scrolling on touch devices). Restores the prior value on close.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  if (!session) return <Navigate to="/login" replace />;
  const sections = sectionsFor(session);

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            {/* Mobile menu toggle — visible only below the sm breakpoint. */}
            <button
              ref={toggleRef}
              type="button"
              className="sm:hidden inline-flex h-9 w-9 items-center justify-center rounded-ogc border border-border"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((v) => !v)}
            >
              <span aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
            </button>
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
            <ThemeToggle />
            <Button variant="ghost" onClick={signOut}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile navigation drawer. */}
      {menuOpen ? (
        <div className="sm:hidden">
          <div
            className="fixed inset-0 z-20 bg-black/40"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <nav
            id="mobile-nav"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onKeyDown={trapTab}
            className="fixed inset-y-0 left-0 z-30 w-72 max-w-[85%] space-y-1 border-r border-border bg-surface p-4 shadow-lg"
          >
            <p className="px-3 pb-2 text-xs uppercase tracking-wide text-muted">Navigate</p>
            {sections.map((s, i) => (
              <NavLink
                key={s}
                ref={i === 0 ? firstLinkRef : undefined}
                to={sectionRoute[s]}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `block rounded-ogc px-3 py-2 text-sm ${isActive ? "bg-brand text-brand-fg" : "hover:bg-border/40"}`
                }
              >
                {sectionLabel[s]}
              </NavLink>
            ))}
          </nav>
        </div>
      ) : null}

      <main id="main" className="mx-auto max-w-6xl px-4 py-8">
        <RequireIiosContext>
          <Outlet />
        </RequireIiosContext>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 pb-6 text-xs text-muted">
        <span data-testid="build-id">OGC · build {__OGC_BUILD__} · synthetic demo</span>
        <DemoDataReset />
      </footer>

      <KeyboardHelp />
    </div>
  );
}
