// Reusable, responsive, accessible UI primitives (Architecture requirement #6).
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const base =
    "inline-flex items-center justify-center rounded-ogc px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles =
    variant === "primary"
      ? "bg-brand text-brand-fg hover:opacity-90"
      : "bg-transparent text-fg border border-border hover:bg-surface";
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-ogc border border-border bg-surface p-4 ${className}`}>{children}</div>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
    </header>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-brand"
      />
      {label}…
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card className="text-center">
      <p className="font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm text-muted">{hint}</p> : null}
    </Card>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card className="border-danger/40">
      <p role="alert" className="text-sm text-danger">
        {message}
      </p>
      {onRetry ? (
        <Button variant="ghost" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </Card>
  );
}

export function NonProductionBanner() {
  return (
    <div className="bg-danger/10 text-danger text-center text-xs py-1 px-3 border-b border-danger/30">
      NON-PRODUCTION · synthetic demo data · mock authorization · not for real learner data
    </div>
  );
}
