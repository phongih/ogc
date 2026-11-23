/*
 * Platform session: the opaque IIOS grant the browser presents, per tab (sessionStorage), like
 * the demo's sign-in. The browser never sees a key and never decides access — the API asks IIOS.
 */
export interface PlatformSession {
  grant: string;
  orgId: string;
  orgName: string;
  principalId: string;
  displayName: string;
  role: string;
  /** IIOS member attribute (display only: the API and IIOS decide every request). */
  orgAdmin?: boolean;
  expiresAt: string;
}

const KEY = "ogc.platform.session";

export function loadSession(): PlatformSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as PlatformSession;
    return Date.parse(s.expiresAt) > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: PlatformSession | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the session lives only in memory for this page */
  }
}
