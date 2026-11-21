/*
 * Demo data that survives a page reload (owner, 21/11: "a new center did not stay"). NON-PRODUCTION:
 * the synthetic mock stores are saved to THIS browser's localStorage — no server, no real data.
 * Every in-memory store registers a dump / load pair here. Saved after each write (the UI's
 * refreshLearningState) and when the page is hidden; loaded once at startup. "Reset demo data"
 * clears it. Bump SCHEMA when a store's shape changes: older saves are then discarded.
 */
export const DEMO_STORAGE_KEY = "ogc.demo";
export const SCHEMA = 1;

interface Persistent {
  dump(): unknown;
  load(data: unknown): void;
}
const registry = new Map<string, Persistent>();

/** Called at module load by each mock store. */
export function registerPersistent(key: string, p: Persistent): void {
  registry.set(key, p);
}

// Maps (nested) ⇄ JSON.
type Enc = { __map: [unknown, unknown][] } | unknown;
function encode(v: unknown): Enc {
  if (v instanceof Map) return { __map: [...v.entries()].map(([k, x]) => [k, encode(x)]) };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, encode(x)]),
    );
  return v;
}
function decode(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.__map))
      return new Map((o.__map as [unknown, unknown][]).map(([k, x]) => [k, decode(x)]));
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, decode(x)]));
  }
  return v;
}

/** Replace a Map's contents in place. */
export function refill<K, V>(target: Map<K, V>, src: unknown): void {
  target.clear();
  if (src instanceof Map) for (const [k, v] of src) target.set(k as K, v as V);
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

// Set by a reset: the page is about to reload, and the pagehide save must not write the old
// state back (seen in E2E: the reset "did not take").
let saving = true;

export function saveDemoState(): void {
  const s = storage();
  if (!s || !saving) return;
  try {
    const data = Object.fromEntries([...registry].map(([k, p]) => [k, encode(p.dump())]));
    s.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({ schema: SCHEMA, savedAt: new Date().toISOString(), data }),
    );
  } catch {
    /* quota / private mode — the demo still works in memory */
  }
}

/** Load saved demo data, if any. Returns true when something was restored. */
export function restoreDemoState(): boolean {
  const s = storage();
  if (!s) return false;
  let parsed: { schema?: number; data?: Record<string, unknown> } | null = null;
  try {
    const raw = s.getItem(DEMO_STORAGE_KEY);
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (!parsed) return false;
  if (parsed.schema !== SCHEMA || !parsed.data) {
    clearDemoState();
    return false;
  }
  try {
    for (const [k, p] of registry) if (k in parsed.data) p.load(decode(parsed.data[k]));
    return true;
  } catch {
    clearDemoState(); // a broken save must never break the app
    return false;
  }
}

export function clearDemoState(): void {
  try {
    storage()?.removeItem(DEMO_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

export const registeredKeys = () => [...registry.keys()];

/** Reset to the original demo data: clear the save, stop saving, reload. */
export function resetDemoAndReload(): void {
  saving = false;
  clearDemoState();
  window.location.reload();
}
