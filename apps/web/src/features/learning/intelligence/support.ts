// P1 support signals — moved to @ogc/contracts (owner 23/11) so the Platform API uses the same
// code; re-exported here for the demo's existing imports.
export {
  DEFAULT_SUPPORT_THRESHOLDS as DEFAULT_THRESHOLDS,
  SUPPORT_DROP,
  SUPPORT_LOW_SKILL,
  SUPPORT_VERSION,
  focusSkill,
  supportSignals,
} from "@ogc/contracts";
export type { SupportThresholds } from "@ogc/contracts";
