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
