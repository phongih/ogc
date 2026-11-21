/*
 * In-app notifications from the Decision Engine, for the teacher or the center staff viewing.
 * Shown only when there is something unread (no empty section).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { decisionEngine } from "../../lib/api";
import { useSession } from "../../app/session";
import { formatCenterDateTime } from "../../lib/centerTime";
import { Button, Card } from "../../ui";

const SHOWN = 5;

export function EngineNotifications() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["engine-inbox", viewer],
    queryFn: () => decisionEngine.listNotifications(viewer),
    enabled: !!viewer,
  });
  const read = useMutation({
    mutationFn: (id: string) => decisionEngine.markRead(viewer, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["engine-inbox", viewer] }),
  });
  const unread = (q.data ?? []).filter((n) => !n.read);
  if (unread.length === 0) return null;
  return (
    <section aria-label="Notifications" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Notifications ({unread.length})</h2>
        <Button variant="ghost" onClick={() => read.mutate("all")}>
          Mark all read
        </Button>
      </div>
      <ul className="space-y-2">
        {unread.slice(0, SHOWN).map((n) => (
          <li key={n.id}>
            <Card className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <span>
                <span className="font-medium">{n.priority}</span> · {n.text}{" "}
                <span className="text-xs text-muted">· {formatCenterDateTime(n.at)}</span>
              </span>
              <Button variant="ghost" onClick={() => read.mutate(n.id)}>
                Mark read
              </Button>
            </Card>
          </li>
        ))}
      </ul>
      {unread.length > SHOWN ? (
        <p className="text-xs text-muted">and {unread.length - SHOWN} more</p>
      ) : null}
    </section>
  );
}
