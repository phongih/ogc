import { useEffect, useState } from "react";

// Theme toggle cycling System → Light → Dark. Applies the choice by setting
// document.documentElement[data-theme] (removed for "system", so the prefers-color-scheme
// media query takes over). Persistence is a per-viewer convenience in localStorage, guarded
// by try/catch (storage can throw or be unavailable — the app works without it).
const ORDER = ["system", "light", "dark"] as const;
type Theme = (typeof ORDER)[number];
const STORAGE_KEY = "ogc-theme";

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable — fall back to system */
  }
  return "system";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(readStored);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore storage write failures */
    }
  }, [theme]);

  const cycle = () => setTheme((t) => ORDER[(ORDER.indexOf(t) + 1) % ORDER.length]);
  const label = theme === "system" ? "System" : theme === "light" ? "Light" : "Dark";
  const icon = theme === "system" ? "🖥️" : theme === "light" ? "☀️" : "🌙";

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={`Theme: ${label}. Activate to change.`}
      title={`Theme: ${label}`}
      className="inline-flex items-center gap-1 rounded-ogc border border-border px-2.5 py-1.5 text-sm hover:bg-surface"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
