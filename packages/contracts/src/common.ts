import { z } from "zod";

export const Id = z.string().uuid();
export const Slug = z
  .string()
  .min(2)
  .regex(/^[a-z0-9-]+$/, "slug must be lowercase alphanumeric with hyphens");

export type Result<T> = { data: T };
