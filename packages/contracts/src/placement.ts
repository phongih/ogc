import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";
import { CourseLevel } from "./catalog.js";
import { skillMap } from "./profile.js";

/*
 * LEARNER INTELLIGENCE — Placement (LI-1), the ENTRY of the loop.
 *
 * A PlacementResult establishes a learner's starting point: a CEFR band plus a
 * per-skill seed (0..100). NON-PRODUCTION: the result is a deterministic fixture,
 * not a real adaptive test engine. The profile seed is derived purely from this.
 */
export const PlacementResult = z.object({
  learnerId: Id,
  orgId: Id, // tenant root — placement is org-scoped like everything else
  cefrBand: CourseLevel,
  // Initial per-skill estimate. Covers every Skill in the taxonomy (total map).
  skillSeed: skillMap(z.number().min(0).max(100)),
});
export type PlacementResult = z.infer<typeof PlacementResult>;

// Self-scoped read of a learner's own placement. Fail-closed: null when the persona
// is not a learner or has no placement on record.
export interface PlacementPort {
  getPlacement(viewer: IiosGrantedContext): Promise<PlacementResult | null>;
}
