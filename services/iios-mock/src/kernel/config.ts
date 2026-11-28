// Build a KernelDirectory from the environment (S3c, OGC-ADR-043). Returns undefined when the
// kernel is not configured, so iios-mock falls back to the seed directory (flag off by default).
//
// Env:
//   OGC_IIOS_KERNEL_HOST   — presence enables kernel-backed resolve
//   OGC_IIOS_KERNEL_PORT   — default 5433
//   OGC_IIOS_KERNEL_DB     — default 'dak'
//   OGC_IIOS_KERNEL_ORGS   — JSON: { "<mockOrgId>": { role, password, keyId, key(base64) }, … }
import { KernelDirectory, type KernelOrg } from "./client.js";

export function kernelFromEnv(env: NodeJS.ProcessEnv): KernelDirectory | undefined {
  const host = env.OGC_IIOS_KERNEL_HOST;
  if (!host) return undefined;
  const raw = env.OGC_IIOS_KERNEL_ORGS;
  if (!raw) throw new Error("iios-mock: OGC_IIOS_KERNEL_HOST set but OGC_IIOS_KERNEL_ORGS missing");

  let parsed: Record<string, { role?: string; password?: string; keyId?: string; key?: string }>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("iios-mock: OGC_IIOS_KERNEL_ORGS is not valid JSON");
  }

  const orgs = new Map<string, KernelOrg>();
  for (const [orgId, o] of Object.entries(parsed)) {
    if (!o.role || !o.password || !o.keyId || !o.key)
      throw new Error(`iios-mock: OGC_IIOS_KERNEL_ORGS[${orgId}] needs role, password, keyId, key`);
    const key = Buffer.from(o.key, "base64");
    if (key.length < 32) throw new Error(`iios-mock: OGC_IIOS_KERNEL_ORGS[${orgId}].key must be ≥ 32 bytes`);
    orgs.set(orgId, { role: o.role, password: o.password, keyId: o.keyId, key });
  }
  if (orgs.size === 0) throw new Error("iios-mock: OGC_IIOS_KERNEL_ORGS has no organizations");

  return new KernelDirectory({
    host,
    port: Number(env.OGC_IIOS_KERNEL_PORT ?? 5433),
    database: env.OGC_IIOS_KERNEL_DB ?? "dak",
    orgs,
  });
}
