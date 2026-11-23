/*
 * Decision Engine rule set (synthetic, per organization, kept in this browser via persist.ts).
 * Separate from the runner so the support queue can read rule settings without an import cycle.
 */
import type { Rule, RuleKind } from "@ogc/contracts";
import { DEFAULT_ENGINE_RULES as DEFAULT_RULES } from "@ogc/contracts";
import { organizations } from "../../fixtures/directory";
import { refill, registerPersistent } from "./persist";

// The default rule set lives in @ogc/contracts (owner 23/11): the demo and the Platform seed the same.
export { DEFAULT_RULES };

// orgId → rules
const rulesByOrg = new Map<string, Rule[]>();
function seed(orgId: string): Rule[] {
  const list = DEFAULT_RULES.map((r, i) => ({
    ...r,
    params: { ...r.params },
    actions: [...r.actions],
    id: `R-${i + 1}`,
  }));
  rulesByOrg.set(orgId, list);
  return list;
}
export function rulesFor(orgId: string): Rule[] {
  const list = rulesByOrg.get(orgId);
  if (!list) return seed(orgId);
  // A save from before a rule existed (e.g. invoice_overdue, 22/11): add the missing defaults.
  DEFAULT_RULES.forEach((r, i) => {
    if (!list.some((x) => x.kind === r.kind))
      list.push({ ...r, params: { ...r.params }, actions: [...r.actions], id: `R-${i + 1}` });
  });
  return list;
}
export function resetRules(): void {
  rulesByOrg.clear();
}
/** The (enabled) rule of a kind, or null when paused. */
export function activeRule(orgId: string, kind: RuleKind): Rule | null {
  const r = rulesFor(orgId).find((x) => x.kind === kind);
  return r && r.enabled ? r : null;
}
/** Does this kind show in "Learners needing support"? (enabled AND the queue action is on) */
export function queues(orgId: string, kind: RuleKind): Rule | null {
  const r = activeRule(orgId, kind);
  return r && r.actions.includes("support_queue") ? r : null;
}
export const knownOrgs = () => organizations.map((o) => o.id);

registerPersistent("engineRules", {
  dump: () => ({ rulesByOrg }),
  load: (raw) => refill(rulesByOrg, (raw as { rulesByOrg?: unknown }).rulesByOrg),
});
