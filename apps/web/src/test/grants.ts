/*
 * Tests only (OGC-ADR-039 step 3b): the IIOS-granted context the MOCK IIOS issues for a demo
 * persona right now — what the gate would hand to a page. Adapters take this, never a persona id.
 */
import type { IiosGrantedContext } from "@ogc/contracts";
import { personaMap } from "../fixtures/personas";
import { resolveGrantSync, validGrantTokenFor } from "../lib/integration/mockIiosContext";

export function as(personaId: string): IiosGrantedContext {
  const orgId = personaMap[personaId]?.orgId;
  // Not a demo persona: a VALID grant for a principal OGC has no record of — must get nothing.
  if (!orgId) return unknownPrincipal(personaId);
  const r = resolveGrantSync(validGrantTokenFor(personaId), orgId);
  if (r.state !== "valid" || !r.context)
    throw new Error(`no valid grant for ${personaId}: ${r.state}`);
  return r.context;
}

function unknownPrincipal(tag: string): IiosGrantedContext {
  return {
    clientId: "eduos",
    orgId: "00000000-0000-4000-8000-000000000001",
    principalId: `iios-principal-unknown-${tag}`,
    role: "learner",
    purpose: "learning.read",
    requestId: "req-synth-test",
    grantRef: "iios-grant-ref-test",
    expiresAt: "2099-01-01T00:00:00.000Z",
  };
}
