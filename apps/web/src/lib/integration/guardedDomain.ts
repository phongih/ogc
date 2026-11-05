import type {
  ClientCatalogEntry,
  ClientCatalogPort,
  IiosContextPort,
  IiosGrantedContext,
} from "@ogc/contracts";
import { requireValidContext } from "@ogc/contracts";

/*
 * OGC-AUTH-027 / Phase 1 DESIGN — the authorization boundary, in one place (SYNTHETIC).
 *
 * A domain operation runs ONLY behind a valid IIOS-granted context. The client catalog is looked
 * up for DESCRIPTIVE purposes (display name, capability labels) and is DELIBERATELY not consulted
 * for the authorization gate: `requireValidContext` is the sole choke-point. This encodes
 * OGC-DEC-027 Option C — authorization is IIOS-granted; the catalog never decides access.
 */

export interface GuardedArgs {
  presentedGrant: string; // opaque IIOS-sealed grant, as received (never decoded/verified by OGC)
  intendedOrgId: string; // the tenant the caller intends to act in
  clientId: string; // used only for descriptive catalog lookup
}

export interface GuardedOutcome<T> {
  ok: boolean;
  reason?: string; // iios_context_denied:<state> on a closed gate
  client?: ClientCatalogEntry | null; // descriptive metadata only (never affects `ok`)
  result?: T;
}

export async function guardedLearningOperation<T>(
  catalog: ClientCatalogPort,
  iios: IiosContextPort,
  args: GuardedArgs,
  op: (ctx: IiosGrantedContext) => T,
): Promise<GuardedOutcome<T>> {
  // DESCRIPTIVE lookup — for presentation/metadata only; has NO bearing on the gate below.
  const client = await catalog.getClient(args.clientId);

  // THE gate: authorization comes solely from the IIOS-decided context, fail-closed.
  const resolution = await iios.resolveContext(args.presentedGrant, args.intendedOrgId);
  try {
    const ctx = requireValidContext(resolution);
    return { ok: true, client, result: op(ctx) };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, client };
  }
}
