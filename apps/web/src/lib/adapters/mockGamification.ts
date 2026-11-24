/*
 * Gamification — MOCK adapter (SYNTHETIC, browser memory). Owner decisions 22/11: rewards come only
 * from learning evidence, DERIVED on every read (nothing is awarded or stored by hand); XP + levels,
 * a streak of learning days, badges and a weekly class leaderboard; the learner and their guardian
 * see it; center staff tune the closed catalog. Every reward line names its evidence.
 */
import {
  applyGamificationUpdate,
  DEFAULT_GAMIFICATION,
  deriveRewards,
  gamificationView,
  weeklyXpOf,
} from "@ogc/contracts";
import type {
  GamificationPort,
  GamificationSettings,
  GamificationUpdate,
  GamificationUpdateResult,
  IiosGrantedContext,
  LearnerGamification,
  RewardEvidence,
} from "@ogc/contracts";
import { activities } from "../../fixtures/activities";
import { classes, rosters } from "../../fixtures/teaching";
import { refill, registerPersistent } from "./persist";
import { sessionStore } from "./sessionStore";
import { learningStore } from "./store";
import { makeupItems } from "./mockMakeup";
import { allows } from "./accessPolicy";
import { guardianLinksOf, learnerIdOf, staffOrgOf } from "./viewer";
import { withFault } from "./faults";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export const DEFAULT_SETTINGS: GamificationSettings = DEFAULT_GAMIFICATION;

const settingsByOrg = new Map<string, GamificationSettings>();
const settingsFor = (orgId: string): GamificationSettings => {
  let s = settingsByOrg.get(orgId);
  if (!s) {
    s = structuredClone(DEFAULT_SETTINGS);
    settingsByOrg.set(orgId, s);
  }
  return s;
};
sessionStore.onReset(() => settingsByOrg.clear());
registerPersistent("gamification", {
  dump: () => ({ settingsByOrg }),
  load: (raw) => refill(settingsByOrg, (raw as { settingsByOrg?: unknown }).settingsByOrg),
});

// ── evidence (the rules themselves are shared: @ogc/contracts gamification) ────────────────

function evidenceOf(orgId: string, learnerId: string): RewardEvidence[] {
  const out: RewardEvidence[] = [];
  for (const a of learningStore.completionsOf(learnerId)) {
    const act = activities.find((x) => x.id === a.activityId);
    if (!act || act.orgId !== orgId) continue;
    // A speaking activity completes only when the teacher approves the rehearsal.
    if (act.kind === "speaking") out.push({ kind: "speaking", at: a.recordedAt, title: act.title });
    else out.push({ kind: "activity", at: a.recordedAt, title: act.title, score: a.score });
  }
  for (const m of makeupItems(orgId)) {
    if (m.learnerId !== learnerId || m.status !== "done") continue;
    out.push({
      kind: "makeup",
      at: m.booking?.selfStudy?.confirmedAt ?? m.booking?.at ?? m.dueAt,
      dueAt: m.dueAt,
      unitTitle: m.unitTitle,
      className: m.className,
    });
  }
  return out;
}

function classOf(orgId: string, learnerId: string) {
  return classes.find(
    (c) => c.orgId === orgId && (rosters[c.id] ?? []).some((r) => r.learnerId === learnerId),
  );
}

function view(orgId: string, learnerId: string, forGuardian: boolean): LearnerGamification {
  const s = settingsFor(orgId);
  const now = Date.now();
  const cls = classOf(orgId, learnerId);
  const name =
    (cls && rosters[cls.id]?.find((r) => r.learnerId === learnerId)?.displayName) ?? "Learner";
  return gamificationView({
    learnerId,
    displayName: name,
    evidence: evidenceOf(orgId, learnerId),
    settings: s,
    now,
    forGuardian,
    klass: cls
      ? {
          name: cls.name,
          members: (rosters[cls.id] ?? []).map((r) => ({
            learnerId: r.learnerId,
            name: r.displayName,
            weeklyXp: weeklyXpOf(deriveRewards(evidenceOf(orgId, r.learnerId), s).events, now),
          })),
        }
      : null,
  });
}

// ── port ──────────────────────────────────────────────────────────────────────────────────

export const mockGamification: GamificationPort = {
  getMine: (viewer: IiosGrantedContext) =>
    withFault("gamification.getMine", () => {
      const own = learnerIdOf(viewer);
      if (own) return latency([view(viewer.orgId, own, false)]);
      const linked = guardianLinksOf(viewer);
      return latency(linked.map((id) => view(viewer.orgId, id, true)));
    }),

  getSettings: (viewer) =>
    withFault("gamification.getSettings", () => {
      const org = staffOrgOf(viewer);
      return latency(org ? structuredClone(settingsFor(org)) : null);
    }),

  updateSettings: (viewer, patch: GamificationUpdate) =>
    withFault("gamification.updateSettings", () => {
      const org = staffOrgOf(viewer);
      if (!org) return latency<GamificationUpdateResult>({ ok: false, reason: "not_staff" });
      if (!allows(viewer, "rewards:manage"))
        return latency<GamificationUpdateResult>({ ok: false, reason: "access_policy" });
      const r = applyGamificationUpdate(settingsFor(org), patch);
      if (!r.ok)
        return latency<GamificationUpdateResult>({
          ok: false,
          reason: "invalid",
          detail: r.detail,
        });
      const next = r.settings;
      settingsByOrg.set(org, next);
      return latency<GamificationUpdateResult>({ ok: true, settings: structuredClone(next) });
    }),
};
