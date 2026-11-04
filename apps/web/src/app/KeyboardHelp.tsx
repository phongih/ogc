import { useEffect, useState } from "react";

// Global keyboard-shortcut help: press "?" (outside a text field) to open a dialog listing
// the app's shortcuts; Esc or Close dismisses it.
export function KeyboardHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (!typing && e.key === "?") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        className="w-full max-w-sm rounded-ogc border border-border bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-medium">Keyboard shortcuts</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt>Show this help</dt>
            <dd>
              <kbd className="rounded border border-border bg-border/40 px-1.5 py-0.5 text-xs">?</kbd>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Close a menu or dialog</dt>
            <dd>
              <kbd className="rounded border border-border bg-border/40 px-1.5 py-0.5 text-xs">Esc</kbd>
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt>Skip to main content</dt>
            <dd>
              <kbd className="rounded border border-border bg-border/40 px-1.5 py-0.5 text-xs">Tab</kbd>
            </dd>
          </div>
        </dl>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-4 rounded-ogc border border-border px-3 py-1.5 text-sm hover:bg-border/40"
        >
          Close
        </button>
      </div>
    </div>
  );
}
