import { z } from "zod";
import { Id, Slug } from "./common.js";

// Organization is the immutable tenant root (Architecture requirement #1).
// Brand and Center are subordinate to Organization (requirement #2).
export const Organization = z.object({
  id: Id,
  name: z.string().min(1),
  slug: Slug,
  createdAt: z.string(), // ISO; immutable once created
});
export type Organization = z.infer<typeof Organization>;

export const Brand = z.object({
  id: Id,
  orgId: Id,
  name: z.string().min(1),
  slug: Slug,
});
export type Brand = z.infer<typeof Brand>;

export const Center = z.object({
  id: Id,
  orgId: Id,
  brandId: Id,
  name: z.string().min(1),
  city: z.string().min(1),
});
export type Center = z.infer<typeof Center>;

export const CenterDetail = Center.extend({
  addressLine: z.string(),
  roomCount: z.number().int().nonnegative(),
  activeCourses: z.number().int().nonnegative(),
});
export type CenterDetail = z.infer<typeof CenterDetail>;

// API contract — independent of any implementation (requirement #3).
// A governed backend adapter can replace the mock later (requirement #5).
export interface OgcDirectoryPort {
  listOrganizations(): Promise<Organization[]>;
  getOrganization(orgId: string): Promise<Organization | null>;
  listBrands(orgId: string): Promise<Brand[]>;
  listCenters(orgId: string, brandId?: string): Promise<Center[]>;
  getCenter(centerId: string): Promise<CenterDetail | null>;
}
