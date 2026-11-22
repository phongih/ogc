/*
 * OGC-ADR-039 step 3b — who the caller is, read from the IIOS-GRANTED CONTEXT (SYNTHETIC, mock).
 *
 * Authority (tenant, role, narrowing) comes only from the grant IIOS decided. The lookups below map
 * an IIOS principal to OGC's OWN records (which OGC teacher profile / learner / guardian link
 * belongs to that principal) — OGC domain data, not a grant. A principal OGC does not know, or a
 * role that does not match the record, resolves to nothing (fail-closed).
 */
import type { IiosGrantedContext } from "@ogc/contracts";
import { members, personaMap, type PersonaMapping } from "../../fixtures/personas";

function recordOf(v: IiosGrantedContext): PersonaMapping | null {
  const m = members.find((x) => x.principalId === v.principalId && x.orgId === v.orgId);
  const p = m ? personaMap[m.personaId] : undefined;
  return p && p.orgId === v.orgId ? p : null;
}

/** The org a staff grant may operate in (IIOS role "staff"), else null. */
export const staffOrgOf = (v: IiosGrantedContext): string | null =>
  v.role === "staff" ? v.orgId : null;

/** The OGC teacher record of a teacher grant, else null. */
export const teacherIdOf = (v: IiosGrantedContext): string | null =>
  v.role === "teacher" ? (recordOf(v)?.teacherId ?? null) : null;

/** The OGC learner record of a learner grant, else null. */
export const learnerIdOf = (v: IiosGrantedContext): string | null =>
  v.role === "learner" ? (recordOf(v)?.learnerId ?? null) : null;

/** Learners a guardian grant is linked to — pre-established links only (D-14). */
export const guardianLinksOf = (v: IiosGrantedContext): string[] =>
  v.role === "guardian" ? [...(recordOf(v)?.linkedLearnerIds ?? [])] : [];

/** Display name of the principal, for history / audit lines. */
export const displayNameOf = (v: IiosGrantedContext): string =>
  members.find((x) => x.principalId === v.principalId)?.displayName ?? v.principalId;

/**
 * OGC's own account key for a principal (the demo persona id), derived from the GRANT — tenant,
 * principal and role must all match OGC's record, else "" (which resolves to nothing downstream).
 * The frontend never supplies it.
 */
export function ogcAccountOf(v: IiosGrantedContext): string {
  const m = members.find((x) => x.principalId === v.principalId && x.orgId === v.orgId);
  const p = m ? personaMap[m.personaId] : undefined;
  if (!m || !p || p.orgId !== v.orgId) return "";
  const fits =
    v.role === "staff"
      ? !!p.staff
      : v.role === "teacher"
        ? !!p.teacherId
        : v.role === "learner"
          ? !!p.learnerId
          : v.role === "guardian"
            ? !!p.guardianId
            : false;
  return fits ? m.personaId : "";
}

const isGrant = (x: unknown): x is IiosGrantedContext =>
  !!x && typeof x === "object" && "principalId" in x && "orgId" in x && "role" in x;

/** A port implementation still written against OGC account keys (internal only). */
export type PersonaKeyed<T> = {
  [K in keyof T]: T[K] extends (v: IiosGrantedContext, ...a: infer A) => infer R
    ? (account: string, ...a: A) => R
    : T[K];
};

/**
 * OGC-ADR-039 step 3b (learning ports): expose an account-keyed implementation as a port that
 * takes the IIOS-granted context. Every method whose first argument is a grant gets the OGC
 * account derived from that grant (`ogcAccountOf`); other methods pass through unchanged.
 */
export function viaGrant<T extends object>(impl: PersonaKeyed<T>): T {
  const out: Record<string, unknown> = {};
  for (const [k, fn] of Object.entries(impl as Record<string, unknown>)) {
    out[k] =
      typeof fn === "function"
        ? (a0: unknown, ...rest: unknown[]) =>
            isGrant(a0)
              ? (fn as (...a: unknown[]) => unknown)(ogcAccountOf(a0), ...rest)
              : (fn as (...a: unknown[]) => unknown)(a0, ...rest)
        : fn;
  }
  return out as T;
}
