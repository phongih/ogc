import { afterEach, describe, expect, it } from "vitest";
import { clearAllFaults, setFault, withFault } from "./faults";

afterEach(() => clearAllFaults());

describe("fault injection (deterministic, no network)", () => {
  it("runs the operation normally when no fault is set", async () => {
    const result = await withFault("x", () => Promise.resolve(42));
    expect(result).toBe(42);
  });

  it("rejects immediately on an 'error' fault", async () => {
    setFault("x", "error");
    await expect(withFault("x", () => Promise.resolve(1))).rejects.toThrow(/injected_fault:x/);
  });

  it("rejects after a bounded delay on a 'timeout' fault", async () => {
    setFault("x", "timeout");
    await expect(withFault("x", () => Promise.resolve(1))).rejects.toThrow(/injected_timeout:x/);
  });

  it("recovers once the fault is cleared", async () => {
    setFault("x", "error");
    await expect(withFault("x", () => Promise.resolve(1))).rejects.toThrow();
    clearAllFaults();
    await expect(withFault("x", () => Promise.resolve(7))).resolves.toBe(7);
  });

  it("only the labelled operation is affected", async () => {
    setFault("a", "error");
    await expect(withFault("b", () => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
