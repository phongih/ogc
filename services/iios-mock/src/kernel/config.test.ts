// kernelFromEnv parsing (S3c). Pure — no database.
import { describe, it, expect } from "vitest";
import { kernelFromEnv } from "./config.js";

const okOrgs = JSON.stringify({
  "00000000-0000-4000-8000-000000000001": {
    role: "iios_app_o_alpha",
    password: "pw",
    keyId: "k1",
    key: Buffer.alloc(32, 7).toString("base64"),
  },
});

describe("kernelFromEnv", () => {
  it("returns undefined when OGC_IIOS_KERNEL_HOST is unset (flag off)", () => {
    expect(kernelFromEnv({} as NodeJS.ProcessEnv)).toBeUndefined();
  });

  it("builds a directory from a valid env", () => {
    const dir = kernelFromEnv({ OGC_IIOS_KERNEL_HOST: "127.0.0.1", OGC_IIOS_KERNEL_ORGS: okOrgs } as NodeJS.ProcessEnv);
    expect(dir).toBeDefined();
  });

  it("throws when HOST is set but ORGS is missing", () => {
    expect(() => kernelFromEnv({ OGC_IIOS_KERNEL_HOST: "127.0.0.1" } as NodeJS.ProcessEnv)).toThrow(/ORGS/);
  });

  it("throws on invalid JSON", () => {
    expect(() =>
      kernelFromEnv({ OGC_IIOS_KERNEL_HOST: "h", OGC_IIOS_KERNEL_ORGS: "{not json" } as NodeJS.ProcessEnv),
    ).toThrow(/valid JSON/);
  });

  it("throws when an org entry is missing fields", () => {
    const bad = JSON.stringify({ o1: { role: "r" } });
    expect(() =>
      kernelFromEnv({ OGC_IIOS_KERNEL_HOST: "h", OGC_IIOS_KERNEL_ORGS: bad } as NodeJS.ProcessEnv),
    ).toThrow(/role, password, keyId, key/);
  });

  it("throws when a key is shorter than 32 bytes", () => {
    const bad = JSON.stringify({ o1: { role: "r", password: "p", keyId: "k1", key: Buffer.alloc(8).toString("base64") } });
    expect(() =>
      kernelFromEnv({ OGC_IIOS_KERNEL_HOST: "h", OGC_IIOS_KERNEL_ORGS: bad } as NodeJS.ProcessEnv),
    ).toThrow(/32 bytes/);
  });
});
