/*
 * Rewards (center staff) — tune gamification within a closed catalog, as with the Decision
 * Engine. Owner decisions 22/11: rewards come only from learning evidence; staff enable / pause
 * rewards and badges, set XP and thresholds, and switch the weekly class leaderboard on or off.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GamificationSettings, GamificationUpdate } from "@ogc/contracts";
import { gamification } from "../../lib/api";
import { useViewer } from "../../app/iiosGate";
import { refreshLearningState } from "../../lib/invalidate";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";
import { AccessBanner } from "../access/AccessBanner";
import { useMyAccess } from "../access/useMyAccess";

export function RewardsSettingsPage() {
  const viewer = useViewer();
  const q = useQuery({
    queryKey: ["gamification-settings", viewer],
    queryFn: () => gamification.getSettings(viewer),
  });
  if (q.isLoading) return <Spinner label="Loading rewards" />;
  if (q.isError)
    return <ErrorState message="Could not load rewards." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Rewards are set by center staff" />;
  return <Editor key={JSON.stringify(q.data)} settings={q.data} />;
}

function Editor({ settings }: { settings: GamificationSettings }) {
  const viewer = useViewer();
  const qc = useQueryClient();
  const me = useMyAccess();
  const canManage = me.data?.allowed["rewards:manage"] ?? true;
  const [draft, setDraft] = useState<GamificationSettings>(structuredClone(settings));
  const save = useMutation({
    mutationFn: (patch: GamificationUpdate) => gamification.updateSettings(viewer, patch),
    onSuccess: () => refreshLearningState(qc),
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const num = "w-20 rounded-ogc border border-border bg-surface p-1 text-sm";

  return (
    <section className="space-y-6">
      <PageHeader title="Rewards" subtitle="Gamification · synthetic demo" />
      <p className="text-xs text-muted">
        Rewards are derived from learning evidence only — completed work, practice scores,
        teacher-approved speaking, make-ups. Nothing is awarded by hand and nothing counts logging
        in. Learners and their guardians see them; teachers keep seeing evidence only.
      </p>
      <AccessBanner />

      <section aria-label="Rewards for evidence" className="space-y-2">
        <h2 className="text-lg font-medium">XP for evidence</h2>
        {draft.rules.map((r, i) => (
          <Card key={r.kind} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{r.name}</p>
              <p className="text-sm text-muted">{r.description}</p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`${r.name}: enabled`}
                  disabled={!canManage}
                  checked={r.enabled}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setDraft((d) => {
                      const n = structuredClone(d);
                      n.rules[i].enabled = v;
                      return n;
                    });
                  }}
                />
                on
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  aria-label={`${r.name}: XP`}
                  className={num}
                  min={0}
                  max={100}
                  disabled={!canManage}
                  value={r.xp}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setDraft((d) => {
                      const n = structuredClone(d);
                      n.rules[i].xp = v;
                      return n;
                    });
                  }}
                />
                XP
              </label>
            </div>
          </Card>
        ))}
      </section>

      <section aria-label="Badges" className="space-y-2">
        <h2 className="text-lg font-medium">Badges</h2>
        {draft.badges.map((b, i) => (
          <Card key={b.kind} className="flex flex-wrap items-center justify-between gap-3">
            <p>
              <span aria-hidden="true">{b.icon}</span>{" "}
              <span className="font-medium">{b.title}</span>{" "}
              <span className="text-sm text-muted">— {b.how}</span>
            </p>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  aria-label={`${b.title}: enabled`}
                  disabled={!canManage}
                  checked={b.enabled}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setDraft((d) => {
                      const n = structuredClone(d);
                      n.badges[i].enabled = v;
                      return n;
                    });
                  }}
                />
                on
              </label>
              {b.threshold !== null ? (
                <label className="flex items-center gap-1">
                  <input
                    type="number"
                    aria-label={`${b.title}: threshold`}
                    className={num}
                    min={1}
                    max={365}
                    disabled={!canManage}
                    value={b.threshold}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setDraft((d) => {
                        const n = structuredClone(d);
                        n.badges[i].threshold = v;
                        return n;
                      });
                    }}
                  />
                  {b.kind === "streak" ? "days" : "level"}
                </label>
              ) : null}
            </div>
          </Card>
        ))}
      </section>

      <Card className="flex flex-wrap items-center gap-6 text-sm">
        <label className="flex items-center gap-2">
          XP per level
          <input
            type="number"
            aria-label="XP per level"
            className={num}
            min={10}
            max={1000}
            disabled={!canManage}
            value={draft.levelSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              setDraft((d) => ({ ...d, levelSize: v }));
            }}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            aria-label="Weekly class leaderboard"
            disabled={!canManage}
            checked={draft.leaderboardEnabled}
            onChange={(e) => {
              const v = e.target.checked;
              setDraft((d) => ({ ...d, leaderboardEnabled: v }));
            }}
          />
          Weekly class leaderboard (learners see the top 5 of their class; guardians see their
          child&apos;s rank only)
        </label>
      </Card>

      {dirty && canManage ? (
        <Button
          onClick={() =>
            save.mutate({
              rules: draft.rules.map((r) => ({ kind: r.kind, enabled: r.enabled, xp: r.xp })),
              badges: draft.badges.map((b) => ({
                kind: b.kind,
                enabled: b.enabled,
                threshold: b.threshold,
              })),
              levelSize: draft.levelSize,
              leaderboardEnabled: draft.leaderboardEnabled,
            })
          }
        >
          Save rewards
        </Button>
      ) : null}
      {save.data && !save.data.ok ? (
        <p role="alert" className="text-sm text-danger">
          Not saved:{" "}
          {save.data.detail ??
            (save.data.reason === "access_policy"
              ? "your access policy does not allow this"
              : save.data.reason)}
        </p>
      ) : null}
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Center operations
      </Link>
    </section>
  );
}
