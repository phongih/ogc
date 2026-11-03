// Pure, deterministic relative-day label. Compared by UTC calendar day so the result
// does not drift within a day. `nowMs` is injectable for testing.
export function relativeDay(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "Unscheduled";
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "Unscheduled";
  const dayMs = 86_400_000;
  const day = (ms: number) => Math.floor(ms / dayMs);
  const diff = day(then.getTime()) - day(nowMs);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1) return `In ${diff} days`;
  return `${-diff} days ago`;
}
