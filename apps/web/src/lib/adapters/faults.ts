/*
 * Deterministic synthetic fault injection at the mock-adapter boundary (S5-D).
 * NON-PRODUCTION, in-memory only — NO external network or backend is ever involved.
 * Lets tests (and an optional dev hook) force loading/error/timeout behavior so the
 * UI's empty/error/retry paths can be verified, and recovery confirmed by clearing.
 */
export type FaultMode = "error" | "timeout";

const config = new Map<string, FaultMode>();

export function setFault(label: string, mode: FaultMode): void {
  config.set(label, mode);
}
export function clearFault(label: string): void {
  config.delete(label);
}
export function clearAllFaults(): void {
  config.clear();
}
export function getFault(label: string): FaultMode | undefined {
  return config.get(label);
}

// Wrap an adapter operation. When a fault is configured for `label`:
//  - "error":   reject immediately (simulated failure)
//  - "timeout": reject after a short deterministic delay (simulated timed-out call)
// Otherwise run the operation normally. Clearing the fault makes the next call succeed,
// which is exactly how a React Query retry/refetch recovers.
export async function withFault<T>(label: string, run: () => Promise<T>): Promise<T> {
  const mode = config.get(label);
  if (mode === "error") throw new Error(`injected_fault:${label}`);
  if (mode === "timeout") {
    await new Promise((r) => setTimeout(r, 30));
    throw new Error(`injected_timeout:${label}`);
  }
  return run();
}

// Optional dev hook so a running page (or E2E) can toggle faults without a backend.
// Guarded so it is a no-op in non-browser/test environments that lack `window`.
declare global {
  interface Window {
    __ogcFaults?: {
      set: typeof setFault;
      clear: typeof clearFault;
      clearAll: typeof clearAllFaults;
    };
  }
}
if (typeof window !== "undefined") {
  window.__ogcFaults = { set: setFault, clear: clearFault, clearAll: clearAllFaults };
}
