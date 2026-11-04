import { Link, useSearchParams } from "react-router-dom";
import type { CourseFormat, CourseLevel } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useCourses } from "./queries";

const LEVELS: CourseLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const FORMATS: CourseFormat[] = ["in_center", "online", "hybrid"];

export function CatalogList() {
  const { session } = useSession();
  // Filters live in the URL query string → shareable links + working browser back/forward.
  const [params, setParams] = useSearchParams();
  const level = (params.get("level") ?? "") as CourseLevel | "";
  const format = (params.get("format") ?? "") as CourseFormat | "";
  const q = params.get("q") ?? "";
  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: false },
    );

  const query = useCourses(session?.orgId ?? "", {
    level: level || undefined,
    format: format || undefined,
    q: q || undefined,
  });

  const filtersActive = Boolean(level || format || q);
  const clearFilters = () => setParams(new URLSearchParams());

  return (
    <section className="space-y-6">
      <PageHeader title="Course catalog" subtitle="Synthetic demo courses" />

      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="sr-only">Search courses</span>
          <input
            value={q}
            onChange={(e) => setParam("q", e.target.value)}
            placeholder="Search title or code"
            aria-label="Search courses"
            className="rounded-ogc border border-border bg-surface px-3 py-1.5 text-sm"
          />
        </label>
        <select
          aria-label="Filter by level"
          value={level}
          onChange={(e) => setParam("level", e.target.value)}
          className="rounded-ogc border border-border bg-surface px-3 py-1.5 text-sm"
        >
          <option value="">All levels</option>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by format"
          value={format}
          onChange={(e) => setParam("format", e.target.value)}
          className="rounded-ogc border border-border bg-surface px-3 py-1.5 text-sm"
        >
          <option value="">All formats</option>
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              {f.replace("_", " ")}
            </option>
          ))}
        </select>
      </div>

      {query.isLoading ? (
        <Spinner label="Loading courses" />
      ) : query.isError ? (
        <ErrorState message="Could not load courses." onRetry={() => query.refetch()} />
      ) : (() => {
        const items = (query.data?.pages ?? []).flatMap((p) => p.items);
        if (items.length === 0) {
          if (filtersActive)
            return (
              <Card className="space-y-3 text-center">
                <p className="font-medium">No courses match these filters</p>
                <div>
                  <Button variant="ghost" onClick={clearFilters}>
                    Clear filters
                  </Button>
                </div>
              </Card>
            );
          return <EmptyState title="No courses available" hint="Synthetic catalog is empty." />;
        }
        return (
          <>
            <p className="text-sm text-muted" aria-live="polite">
              Showing {items.length} course{items.length === 1 ? "" : "s"}
              {query.hasNextPage ? " (more available)" : ""}
              {filtersActive ? (
                <>
                  {" · "}
                  <button type="button" onClick={clearFilters} className="text-brand underline">
                    Clear filters
                  </button>
                </>
              ) : null}
            </p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((c) => (
                <li key={c.id}>
                  <Link to={`/app/catalog/${c.id}`} className="block">
                    <Card className="h-full transition hover:border-brand">
                      <p className="text-xs text-muted">{c.code}</p>
                      <h3 className="mt-1 font-medium">{c.title}</h3>
                      <p className="mt-1 text-sm text-muted">
                        {c.level} · {c.format.replace("_", " ")} · {c.durationWeeks} weeks
                      </p>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
            {query.hasNextPage ? (
              <div className="mt-4">
                <Button
                  variant="ghost"
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage ? "Loading…" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        );
      })()}
    </section>
  );
}
