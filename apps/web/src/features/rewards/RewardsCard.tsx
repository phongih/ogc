/*
 * Gamification card (learner + guardian), shared by the demo and the Platform. Owner decisions
 * 22/11: every reward comes from learning evidence and says which; XP + level, learning-day streak,
 * badges, a weekly class leaderboard. A guardian sees their child's rank only — never classmates'
 * names.
 */
import { useQuery } from "@tanstack/react-query";
import type { LearnerGamification } from "@ogc/contracts";
import { formatCenterDateTime } from "../../lib/centerTime";
import { Card, ProgressBar } from "../../ui";
import { useRewardsApi } from "./rewardsApi";

export function useMyRewards() {
  const api = useRewardsApi();
  return useQuery({ queryKey: api.key, queryFn: () => api.mine() });
}

export function MyRewardsView({
  learnerId,
  guardian = false,
}: {
  learnerId?: string;
  guardian?: boolean;
}) {
  const q = useMyRewards();
  const g = (q.data ?? []).find((x) => !learnerId || x.learnerId === learnerId);
  if (!g) return null;
  return <RewardsCard g={g} guardian={guardian} />;
}

export function RewardsCard({ g, guardian }: { g: LearnerGamification; guardian: boolean }) {
  const pct = Math.round((g.xpIntoLevel / g.levelSize) * 100);
  return (
    <section aria-label={guardian ? `Rewards · ${g.displayName}` : "Streak & rewards"}>
      <h2 className="mb-1 text-lg font-medium">
        {guardian ? `Rewards · ${g.displayName}` : "Streak & rewards"}
      </h2>
      <p className="mb-3 text-xs text-muted">
        Earned only from learning evidence — completed work, practice scores, approved speaking,
        make-ups. Never for logging in.
      </p>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <p className="text-sm">
            <strong className="text-lg" data-testid="level">
              Level {g.level}
            </strong>{" "}
            · <span data-testid="xp">{g.xp} XP</span>
          </p>
          <p className="text-sm" data-testid="streak">
            <span aria-hidden="true">🔥</span>{" "}
            {g.streakDays > 0 ? (
              <>
                <strong>{g.streakDays}-day</strong> learning streak
                {g.activeToday ? "" : " · learn today to keep it"}
              </>
            ) : (
              "No streak yet — complete an activity today to start one"
            )}
          </p>
          <p className="text-sm text-muted">{g.weeklyXp} XP this week</p>
        </div>
        <div>
          <ProgressBar pct={pct} label={`Level ${g.level} progress`} />
          <p className="mt-1 text-xs text-muted">
            {g.xpIntoLevel} / {g.levelSize} XP to level {g.level + 1}
          </p>
        </div>

        <ul className="flex flex-wrap gap-2" aria-label="Badges">
          {g.badges.map((b) => (
            <li key={b.kind}>
              <span
                title={b.how}
                aria-label={`${b.title} ${b.earned ? "(earned)" : `(locked — ${b.how})`}`}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
                  b.earned ? "border-border bg-surface" : "border-border/50 text-muted opacity-60"
                }`}
              >
                <span aria-hidden="true">{b.icon}</span> {b.title}
              </span>
            </li>
          ))}
        </ul>

        {g.recent.length > 0 ? (
          <div>
            <h3 className="mb-1 text-sm font-medium">Recent rewards</h3>
            <ul className="space-y-1 text-sm" aria-label="Recent rewards">
              {g.recent.map((e, i) => (
                <li key={i} className="flex flex-wrap justify-between gap-2">
                  <span>
                    +{e.xp} XP · {e.evidence}
                  </span>
                  <span className="text-xs text-muted">{formatCenterDateTime(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {g.leaderboard ? (
          <div>
            <h3 className="mb-1 text-sm font-medium">This week in {g.leaderboard.className}</h3>
            {guardian ? (
              <p className="text-sm" data-testid="rank">
                {g.displayName} is #{g.leaderboard.yourRank} of {g.leaderboard.size} this week (
                {g.weeklyXp} XP).
              </p>
            ) : (
              <>
                <ol className="space-y-1 text-sm" aria-label="Class leaderboard">
                  {g.leaderboard.top.map((r) => (
                    <li
                      key={`${r.rank}-${r.name}`}
                      className={`flex justify-between ${r.you ? "font-medium text-brand" : ""}`}
                    >
                      <span>
                        #{r.rank} {r.name}
                        {r.you ? " (you)" : ""}
                      </span>
                      <span>{r.weeklyXp} XP</span>
                    </li>
                  ))}
                </ol>
                {g.leaderboard.top.some((r) => r.you) ? null : (
                  <p className="mt-1 text-sm" data-testid="rank">
                    You are #{g.leaderboard.yourRank} of {g.leaderboard.size} ({g.weeklyXp} XP).
                  </p>
                )}
              </>
            )}
          </div>
        ) : null}
      </Card>
    </section>
  );
}
