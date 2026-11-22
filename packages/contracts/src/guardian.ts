import { z } from "zod";
import type { IiosGrantedContext } from "./iiosContext.js";
import { Id } from "./common.js";

export const ConsentStatus = z.enum(["active", "revoked", "none"]);
export type ConsentStatus = z.infer<typeof ConsentStatus>;

export const GuardianLinkView = z.object({
  learnerId: Id,
  displayName: z.string().min(1),
  progressPct: z.number().min(0).max(100),
  consentStatus: ConsentStatus,
  nextSessionAt: z.string().nullable(),
});
export type GuardianLinkView = z.infer<typeof GuardianLinkView>;

export const GuardianDashboard = z.object({
  guardianId: Id,
  guardianName: z.string().min(1),
  orgId: Id,
  links: z.array(GuardianLinkView),
});
export type GuardianDashboard = z.infer<typeof GuardianDashboard>;

export interface GuardianPort {
  getDashboard(viewer: IiosGrantedContext): Promise<GuardianDashboard | null>;
  // D-14: there is deliberately NO self-verification flow here. Guardian relationships
  // are established by a governed backend (future), never self-asserted in this UI.
}
