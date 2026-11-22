/*
 * Tests only (OGC-ADR-039 step 3b): the IIOS-granted context the MOCK IIOS issues for a demo
 * persona right now — what the gate would hand to a page. Adapters take this, never a persona id.
 */
import type { IiosGrantedContext } from "@ogc/contracts";
import { personaMap } from "../fixtures/personas";
import { resolveGrantSync, validGrantTokenFor } from "../lib/integration/mockIiosContext";

export function as(personaId: string): IiosGrantedContext {
  const orgId = personaMap[personaId]?.orgId;
  if (!orgId) throw new Error(`unknown demo persona ${personaId}`);
  const r = resolveGrantSync(validGrantTokenFor(personaId), orgId);
  if (r.state !== "valid" || !r.context)
    throw new Error(`no valid grant for ${personaId}: ${r.state}`);
  return r.context;
}
