# OGC-ADR-039 — Security, Audit & Operational Integrity Foundation

- **Status:** Proposed — survey and design only. Nothing here is approved for implementation.
- **Date:** 22/11/2026
- **Decides:** the owner, and IIOS where IIOS is named. This document lists options; it does not choose for them.
- **Inputs:**
  - HealthcareOS HCOS-F2 (access policy): `HCOS-F2_Access_Policy.md`, migration `007_access_policies.sql`, `access-policy.service.ts`. Only the pattern is read; no source is imported.
  - OGC PR #36–#38.
  - OGC-DEC-027 (Option C) and OGC-IIOS-001, as quoted in `packages/contracts/src/iiosContext.ts`.

> **Non-claims.** OGC is a static SPA with mock adapters and synthetic data. Nothing below is evidence of production readiness, security or compliance. G2-C is NOT PASSED, the 33.S independent review is pending, D-14 is a design gap, R-06 / R-16 are OPEN, and 009B is HELD. This ADR does not change any of them.

Principle: HealthcareOS supplies governance and security **patterns**; OGC translates them for education. We do not copy its implementation, and we do not present the mock as proof.

---

## 1. Three levels — what exists today

| Pattern | Applied in mock | Verified in demo | Ready for a production backend |
|---|---|---|---|
| Access policy narrows a role (role ∩ policy) | Yes — `lib/adapters/accessPolicy.ts` (PR #38) | Yes — 11 unit tests, `e2e/access-journey.mjs`, browser check (log, wave 35) | No |
| Closed action catalog, refused on save, with `path` | Yes — `POLICY_CATALOG` | Unit tests | No |
| Fail-closed on a missing or retired policy | Yes | Unit test (tampered state) | No |
| Optimistic versioning (`expectedVersion`) | Yes, for policies only | Unit test | No |
| Append-only history | Policy history only, kept in localStorage and erased by "Reset demo data" | Unit test | **No** — see F5 |
| Evidence-based decisions (Decision Engine) | Yes — PR #37; every event states its evidence | Unit + E2E | No |
| Tenant = organization (tenant root) | Yes — every staff / teacher check compares `orgId` | Cross-org negative tests in several adapters (F4) | **No backend, no DB, no RLS** |
| IIOS-granted context as the only gate | Route admission only (`RequireIiosContext`, AUTH-027) | `authorizationBoundary.test.ts` | No — and see F2 |
| Idempotent writes | Not designed; some duplicates are blocked by business rules (F6) | — | No |
| Acceptance gates | CI, regression tests run both ways, browser check after each deploy | — | N/A |

---

## 2. Findings from the survey

### F1 — PR #38 may conflict with OGC-DEC-027 (highest priority)

`iiosContext.ts` records the Option C rule: OGC *"never writes an authz relation"* and is *"a pure CONSUMER of the IIOS decision"*.

PR #38 stores "membership → access policy" inside OGC, and an Org Admin edits that link there. Even though it can only narrow, it is an authorization relation written by OGC.

**This should have been raised before PR #38 was merged.** It is raised now. The mock is harmless (synthetic, localStorage only), but the design question is real:

- **Option A — OGC-local deny-only overlay.** Keep policies in OGC, as now. Register this as an explicit, documented exception to DEC-027: OGC may only remove permissions IIOS granted, never add them.
  - Risk: two places to reason about access, and two audit trails.
- **Option B — IIOS owns narrowing.** The policy, or its effect, arrives inside the granted context. OGC only enforces it, and the OGC Access page becomes a read-only view of what IIOS says.
  - Fits DEC-027 as written.
  - Needs IIOS work and a grant-shape change.
- **Option C — hybrid.** IIOS stores the policy and OGC hosts the editing UI, calling IIOS.
  - Same ownership as B, with a better UX.
  - Needs an IIOS write API.

Claude's reading: B or C for anything beyond the demo; A only as a labelled mock. **This decision belongs to the owner and IIOS.**

### F2 — Two authorization paths that do not meet

- **Route admission** uses the IIOS-granted context: role, `orgId`, `principalId`, `requestId`, optional `activeCenter`.
- **Every domain adapter** authorizes by `personaId`, through `fixtures/personas.ts → personaMap` (`staff`, `admin`, `teacherId`, …).

The granted context never reaches the adapters: no adapter reads `principalId` or `requestId`. So the open question "grant `role` ≠ persona role" is not an edge case. It is the symptom of this gap.

PR #38 made it visible again: Olivia's grant says `staff` (IIOS has no admin actor role), while OGC treats her as `admin`.

Proposed direction (to decide): one decision point, `authorize(ctx: IiosGrantedContext, action, resource)`.

- Adapters receive the granted context, not a persona id.
- Persona fixtures become mock *data behind the IIOS mock*, not an authorization source.
- OGC-side roles (Org Admin, center staff, class teacher of class X) are resolved from `principalId` + `orgId`. Resolved by whom (IIOS or OGC) is the F1 question again.

### F3 — Two narrowing sources for "which center"

The granted context already carries `activeCenter` ("narrowing only", AZ7). The PR #38 policy carries a `centerId` condition. Neither knows about the other.

If both stay, the rule must be **intersection**: an action needs both the IIOS active center and the policy to allow the center. It must be written in the contract, not left implicit.

### F4 — Tenant boundary: right shape, uneven proof

- The hierarchy is already **Organization (tenant root) → Center → Class → Session → Learner / enrollment**. Staff checks compare the class's `orgId`, not its center, so center is a narrowing criterion, never the tenant boundary. This matches the external review's concern; nothing to undo.
- Cross-org negative tests exist in several adapters, using a second synthetic org (`demo-staff-org2`, `demo-learner-org2`) and the IIOS `cross_tenant` state. They were written slice by slice, not as one matrix.
- **Gap:** there is no single table asserting that, for every port method, a caller from org B **who knows a valid resource id in org A** gets `not_found` / `null` / `[]`.

### F5 — Audit: demo history is not audit

| Write | Recorded today |
|---|---|
| Policy create / revise / retire | Version snapshot: who (display name), when, rules. In localStorage and erased by Reset. |
| Policy attached to a member | **Nothing** (only the current state) |
| Engine actions | Action Log, in localStorage, erased by Reset |
| Attendance, schedule, substitutes, make-ups, self-study confirm, center setup, rule edits | **Nothing** beyond the resulting state |

- "Who" is a display name, not `principalId`.
- The IIOS `requestId` (meant "for audit correlation with IIOS", OGC-IIOS-001 §8) is never carried into a write.
- HealthcareOS writes, in the **same transaction** as each change: an audit row (with a hash of the rules, not the rules), an outbox event and a version snapshot.

OGC needs an **audit event contract** before any backend exists, so that every write can be reviewed against it.

### F6 — Idempotency: duplicates are blocked by accident

A retried write today usually does not double the effect, but only because a business rule happens to refuse the second call. The retry then looks like a **failure** instead of returning the first result.

| Write | Second identical call today |
|---|---|
| `recordAttendance` | Replaces the whole session's marks. Idempotent by design. |
| `assignTeacher`, `setSubstitute`, make-up `book`, `setMembershipPolicy` | Same end state. Idempotent. |
| `addSession` | Refused as `clash` (the first session is already there) |
| `cancelWithReplacement` | Refused as `cancelled` |
| `openMakeupSession` | Refused as `nothing_open` (items are already booked) |
| `createCenter` | Refused at checklist: center code already taken |
| `createPolicy` | `name_taken` |
| `revisePolicy` / `retirePolicy` | `stale` / `retired` |
| `confirmSelfStudy` | `already_done` |

A backend needs an idempotency key per command, so that the same key returns the same result, and a different payload with the same key is refused.

---

## 3. Proposed work, in order (each item = its own PR, design first)

| # | Work | When | Output |
|---|---|---|---|
| 0 | **Decide F1** (where narrowing policy lives) and **F2** (grant role vs OGC role) | Now — owner + IIOS | A decision recorded in this ADR |
| 1 | Authorization contract: `AuthorizationContext`, `authorize(ctx, action, resource)`, resource → (org, center, class) resolution, intersection with `activeCenter` | After 0 | Contract + tests in `packages/contracts`; adapters migrated in a separate PR |
| 2 | Audit event contract: `{eventId, orgId, principalId, requestId, action, resource, outcome, reason?, at, before/after hash}`. Append-only. Demo events kept apart from "audit". | Next P2 | Contract + a mock sink. The demo label stays explicit. |
| 3 | Idempotency contract: `idempotencyKey` on every write command; same key + same payload → same result; same key + other payload → refused | Before any backend | Contract + test cases (table F6) |
| 4 | Tenant negative-access matrix: every port × {own org, other org with a known id, no context} | Before a multi-tenant backend | One generated test matrix |
| 5 | Transactional outbox + worker reliability | When async work is real | Design only until then |

### Not mixed into this track

Bundle splitting, unit planning per course, seat limits on joins, and editing a center are product work. They stay on the product track, in separate PRs.

---

## 4. Open questions

1. **F1:** A, B or C? If A, who records the DEC-027 exception?
2. **F2:** does IIOS gain an "org admin" notion, or does OGC map `staff` + an OGC membership attribute? This is the existing open question, now with a concrete case.
3. Should demo history (policy versions, engine log) survive "Reset demo data"? Today it does not.
4. Retention of audit events — **not answered here.** It is part of the legal review (Track C) and outside Claude's scope.
