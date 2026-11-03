// Reusable, responsive, accessible UI primitives (Architecture requirement #6).
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: string;
  to?: string;
}

/** Breadcrumb trail rendered as a navigation landmark. The final (currentless) crumb
 *  is marked aria-current="page". */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((it, i) => (
          <li key={`${it.label}-${i}`} className="flex items-center gap-1.5">
            {it.to ? (
              <Link to={it.to} className="text-brand hover:underline">
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-fg">
                {it.label}
              </span>
            )}
            {i < items.length - 1 ? <span aria-hidden="true">/</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}

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

/** Linear progress bar. Shared primitive (was duplicated in learner/learning features). */
export function ProgressBar({
  pct,
  label,
  className = "",
}: {
  pct: number;
  label?: string;
  className?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div
      className={`h-2 w-full overflow-hidden rounded-full bg-border ${className}`.trim()}
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `Progress ${v}%`}
    >
      <div className="h-full bg-brand" style={{ width: `${v}%` }} />
    </div>
  );
}

/** Circular progress ring (SVG donut) with the percentage centered. */
export function ProgressRing({
  pct,
  label,
  size = 72,
  stroke = 8,
}: {
  pct: number;
  label?: string;
  size?: number;
  stroke?: number;
}) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - v / 100);
  return (
    <div
      className="relative inline-flex items-center justify-center text-brand"
      role="progressbar"
      aria-valuenow={v}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `Progress ${v}%`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-border" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <span aria-hidden="true" className="absolute text-sm font-semibold text-fg">
        {v}%
      </span>
    </div>
  );
}

export function NonProductionBanner() {
  return (
    <div className="bg-danger/10 text-danger text-center text-xs py-1 px-3 border-b border-danger/30">
      NON-PRODUCTION · synthetic demo data · mock authorization · not for real learner data
    </div>
  );
}
