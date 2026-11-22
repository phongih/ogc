# OGC-ADR-039 — Security, Audit & Operational Integrity Foundation

- **Status:** Proposed — survey and design only. Nothing here is approved for implementation. **F1 direction chosen by the owner on 22/11 (§5).**
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

1. ~~**F1:** A, B or C?~~ The owner chose the IIOS direction on 22/11 (§5).
2. **F2:** does IIOS gain an "org admin" notion, or does OGC map `staff` + an OGC membership attribute? This is the existing open question, now with a concrete case.
3. Should demo history (policy versions, engine log) survive "Reset demo data"? Today it does not.
4. Under an IIOS `activeCenter`, an organization-level action with no center (e.g. `center:setup`) is **refused** by the contract evaluator (fail-closed, step 1 PR). Confirm with IIOS: should such actions require a grant without an active center?
5. Retention of audit events — **not answered here.** It is part of the legal review (Track C) and outside Claude's scope.

---

## 5. Owner direction, 22/11: build out IIOS (F1 → Option C)

Owner, 22/11: *"mình thấy xây dựng IIOS để mở rộng thực tế"* — build out IIOS so OGC can grow for real. So narrowing policy moves to IIOS, and DEC-027 stays as written: OGC writes no authorization relation.

Read as **Option C**: IIOS stores and decides; the OGC Access page stays as the editing UI, but it calls IIOS instead of storing anything itself.

### What this means in this repository (allowed scope)

- **Contracts only, on the OGC side of the boundary:**
  - the grant carries the narrowing that applies, which OGC enforces;
  - a new `IiosPolicyAdminPort` (list / create / revise / retire / attach) that the Access page calls.
- **The mock IIOS** (`lib/integration/`, synthetic fixtures) implements both. PR #38's store moves behind it. OGC adapters stop reading `personaMap` for permissions and read the granted context instead (F2).
- **Proposed grant change for IIOS (OGC-IIOS-001), not decided by OGC:**
  - an org-admin notion in the grant (F2);
  - the policy effect, or a reference to it, carried with the decision;
  - `activeCenter` ∩ policy centers (F3).

### What this does not mean

- No work on the real IIOS, on the frozen IIOS security source r1, on 009B, or on any production system from this repository or this session. Those stay with the owner / IIOS team and the held gates (G2-C, 33.S, D-14, R-06 / R-16).
- The mock IIOS proving the shape is not evidence that real IIOS can or does behave this way.

### Next PRs (each separate, CI-gated)

1. **Contract:**
   - `IiosGrantedContext` gains `narrowing` (policy rules or a reference to them) and an admin marker;
   - `IiosPolicyAdminPort`;
   - `authorize(ctx, action, resource)`.

   Design-level tests only.
2. **Mock IIOS implements the contract:** the PR #38 policy store moves behind it; the Access page calls the port. Same behaviour, new owner.
3. **Adapters take the granted context** instead of `personaId` for permissions. Olivia's grant carries the admin marker, which closes the F2 mismatch in the mock.
4. Then items 2–5 of §3 (audit event contract, idempotency, tenant matrix, outbox), unchanged.

### Progress

- Step 1 (contract): `packages/contracts/src/authorize.ts` (`authorize`, `authorizeField`, `evaluateRules`); `iiosContext.ts` gains `orgAdmin`, `narrowing` (`GrantNarrowing`: none / policy / unavailable) and `IiosPolicyAdminPort`. Design-level tests in `lib/integration/authorize.test.ts`. The mock store from PR #38 already uses the same rule evaluator. Nothing is wired to adapters yet (steps 2–3).
- Step 2 (mock IIOS owns policies): `lib/integration/mockIiosPolicy.ts` stores policies and their attachment to **IIOS principals**. It implements `IiosPolicyAdminPort` and re-checks admin from its own membership data, so a grant claiming `orgAdmin` is not enough. `mockIiosContext` puts `orgAdmin` + `narrowing` into every resolved grant. The Access page calls the port with the admin's granted context; OGC stores no policy (`MyAccessPort` is the only OGC-side read). `lib/adapters/accessPolicy.ts` only enforces, via `authorize()`; it still rebuilds the context from the persona until step 3. Persist key `access` → `iiosPolicy`: attachments saved by the previous build are not carried over.
- Step 3 (enforce with the decided grant): the IIOS gate records the grant it got on every navigation (`lib/integration/currentGrant.ts`); `null` when IIOS denied, which leaves nothing allowed. `lib/adapters/accessPolicy.ts` passes that grant to `authorize()`, so the role, tenant (derived from the resource's center) and narrowing come from IIOS, not OGC fixtures. Olivia acts as `staff` + `orgAdmin`, as IIOS grants her, so F2 is closed for policy-governed actions.
  - Unit tests that call adapters directly (no gate) get the persona's valid grant from the mock IIOS.
  - Still open (step 3b): port signatures carry the persona id rather than the context; basic membership checks (`staffOrg`, class teacher) still read OGC fixtures; section visibility (`mockCanView`) still follows the mock session role — UI navigation only, never a security control.
- Step 3b (ports take the grant): the operations ports — schedule, make-up, center setup, Decision Engine, attendance, my-access — take the caller's `IiosGrantedContext` as their first argument instead of a persona id. Pages get it from the gate (`useViewer()`, which fails closed outside an admitted route). Adapters read the tenant from `ctx.orgId`, the role from `ctx.role` (staff = IIOS role `staff`) and the narrowing from `ctx.narrowing`; `activeCenter` now also narrows listings. A principal is mapped to OGC's own teacher / learner / guardian-link records in `lib/adapters/viewer.ts`, which is OGC data, not authority; an unknown principal resolves to nothing. `currentGrant.ts` is removed. New synthetic grants were added for Minh and the second-org personas so tests always carry a decided context (`test/grants.ts`).
  - Still persona-keyed (later): learning, practice, speaking, tutor, lesson plan, enrollment, the teacher dashboard and learner / guardian dashboards. Section visibility (`mockCanView`) still follows the mock session role, as UI navigation only. The wizard draft key moved to the principal id, so older drafts are not restored.
