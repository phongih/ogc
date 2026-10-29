import { useState } from "react";
import { Link } from "react-router-dom";
import type { CourseFormat, CourseLevel } from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { useSession } from "../../app/session";
import { useCourses } from "./queries";

const LEVELS: CourseLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const FORMATS: CourseFormat[] = ["in_center", "online", "hybrid"];

export function CatalogList() {
  const { session } = useSession();
  const [level, setLevel] = useState<CourseLevel | "">("");
  const [format, setFormat] = useState<CourseFormat | "">("");
  const [q, setQ] = useState("");

  const query = useCourses(session?.orgId ?? "", {
    level: level || undefined,
    format: format || undefined,
    q: q || undefined,
  });

  return (
    <section className="space-y-6">
      <PageHeader title="Course catalog" subtitle="Synthetic demo courses" />

      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="sr-only">Search courses</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title or code"
            aria-label="Search courses"
            className="rounded-ogc border border-border bg-surface px-3 py-1.5 text-sm"
          />
        </label>
        <select
          aria-label="Filter by level"
          value={level}
          onChange={(e) => setLevel(e.target.value as CourseLevel | "")}
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
          onChange={(e) => setFormat(e.target.value as CourseFormat | "")}
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
        if (items.length === 0)
          return <EmptyState title="No courses match" hint="Try clearing the filters." />;
        return (
          <>
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
