/*
 * OGC-ADR-039 step 3 — the IIOS-granted context the adapters enforce with (SYNTHETIC, mock).
 *
 * The IIOS gate (`RequireIiosContext`) records here the grant IIOS decided for the signed-in
 * persona on every navigation — or `null` when IIOS denied (expired / revoked / missing /
 * cross_tenant), which leaves NOTHING allowed. Adapters ask `grantFor(personaId)` and pass it to
 * the contract's `authorize()`: role, tenant and narrowing come from IIOS, not from OGC fixtures.
 *
 * Outside the app (unit tests that call adapters directly) no gate has run; there the mock IIOS is
 * asked for the persona's valid grant directly — the same decision the gate would get.
 * Port signatures still carry the persona id; threading the context through every port is a
 * later refactor (ADR-039 §5, step 3b).
 */
import type { IiosGrantedContext } from "@ogc/contracts";
import { personaMap } from "../../fixtures/personas";
import { resolveGrantSync, validGrantTokenFor } from "./mockIiosContext";

const current = new Map<string, IiosGrantedContext | null>();

export function setCurrentGrant(personaId: string, ctx: IiosGrantedContext | null): void {
  current.set(personaId, ctx);
}
export const clearCurrentGrants = (): void => current.clear();

export function grantFor(personaId: string): IiosGrantedContext | null {
  if (current.has(personaId)) return current.get(personaId) ?? null;
  const orgId = personaMap[personaId]?.orgId;
  if (!orgId) return null;
  const r = resolveGrantSync(validGrantTokenFor(personaId), orgId);
  return r.state === "valid" && r.context ? r.context : null;
}
