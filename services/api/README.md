# @ogc/api — OGC Platform API (ADR-040)

Fastify + Kysely + PostgreSQL 16. Synthetic data only until the gates in ADR-040 §6 open.

## Request pipeline

1. Request id.
2. The grant is resolved at IIOS (`services/iios-mock` until real IIOS exists). This step is fail-closed.
3. `authorize()` runs; it comes from `@ogc/contracts` and is the same evaluator the demo uses.
4. The handler runs inside the DAK, which is one transaction scoped to the grant's organization by row-level security.
5. The request is audited.

## Environment

| Variable                         | Used by   | Meaning                                               |
| -------------------------------- | --------- | ----------------------------------------------------- |
| `DATABASE_URL`                   | `main`    | Connection as `ogc_app` (not the owner, no BYPASSRLS) |
| `DATABASE_URL_MIGRATE`           | `migrate` | Connection as the owner role that runs migrations     |
| `IIOS_URL`, `IIOS_CLIENT_SECRET` | `main`    | Where to resolve grants, and the client credential    |
| `IIOS_TIMEOUT_MS`                | `main`    | Default 2000; a timeout refuses the request (503)     |
| `HOST`, `PORT`                   | `main`    | Default `127.0.0.1:8788`                              |
| `OGC_DEV_LOGIN=1`                | `main`    | Staging dev sign-in routes; refused in production     |

## Requests

- `Authorization: Bearer <IIOS grant>`
- `X-OGC-Org: <organization id>`
- Writes also need `Idempotency-Key` (8–128 characters).

## Routes (slice 1)

| Route                                                                            | Who                                                               | Port it serves                                       |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| `GET /v1/health`                                                                 | public                                                            | —                                                    |
| `GET /v1/me/access`                                                              | any grant                                                         | `MyAccessPort`                                       |
| `GET /v1/schedule`                                                               | staff (`schedule:manage`, narrowed by center)                     | `SchedulePort.getOverview`                           |
| `POST /v1/sessions/:id/reschedule` `{at}`                                        | staff                                                             | `reschedule`                                         |
| `POST /v1/sessions/:id/cancel` `{replacementAt}`                                 | staff                                                             | `cancelWithReplacement`                              |
| `POST /v1/classes/:id/sessions` `{title, at}`                                    | staff                                                             | `addSession`                                         |
| `PUT /v1/classes/:id/teacher` `{teacherId}`                                      | staff (not if `classTeacher` is read-only)                        | `assignTeacher`                                      |
| `PUT /v1/sessions/:id/substitute` `{teacherId \| null}`                          | staff (not if `substitute` is read-only)                          | `setSubstitute`                                      |
| `GET /v1/classes/:id/sessions`                                                   | the class teacher                                                 | `AttendancePort.listClassSessions`                   |
| `GET` / `PUT /v1/sessions/:id/attendance`                                        | owner or that session's substitute (`attendance:mark`)            | `getSessionAttendance` / `recordAttendance`          |
| `GET /v1/classes/:id/attendance-summary`                                         | the class teacher                                                 | `getClassSummary`                                    |
| `GET /v1/me/to-mark`                                                             | teachers                                                          | `listToMark`                                         |
| `GET /v1/me/classes`                                                             | teachers (403 `not_a_teacher` otherwise)                          | — (teacher home)                                     |
| `GET /v1/dev/personas`, `POST /v1/dev/login`                                     | public, only with `OGC_DEV_LOGIN=1` (staging)                     | — (mock IIOS issues the grant)                       |
| `GET /v1/makeups`                                                                | staff (`makeup:manage`, narrowed by center)                       | `MakeupPort.getBoard`                                |
| `GET /v1/makeups/:item/options`                                                  | staff                                                             | `listOptions`                                        |
| `POST /v1/makeups/:item/book` `{sessionId}`                                      | staff                                                             | `book`                                               |
| `POST /v1/makeups/:item/makeup-session` `{at, teacherId}`                        | staff                                                             | `openMakeupSession`                                  |
| `POST /v1/makeups/:item/self-study`                                              | staff                                                             | `assignSelfStudy`                                    |
| `GET /v1/me/makeups`                                                             | learner (own) · guardian (linked, read-only)                      | `listMine`                                           |
| `POST /v1/me/makeups/:item/self-study` `{note}`                                  | learner (own item)                                                | `submitSelfStudy`                                    |
| `GET /v1/me/makeups/to-confirm`                                                  | the learner's own class teacher                                   | `listToConfirm`                                      |
| `POST /v1/makeups/:item/confirm` / `…/return` `{note}`                           | the learner's own class teacher                                   | `confirmSelfStudy` / `returnSelfStudy`               |
| `GET /v1/workforce`                                                              | staff                                                             | `WorkforcePort.getOverview`                          |
| `PUT /v1/workforce/teachers/:id/target`                                          | staff with `workforce:manage`                                     | `setTarget`                                          |
| `PUT /v1/workforce/settings` `{underPct, overPct}`                               | staff with `workforce:manage`                                     | `updateSettings`                                     |
| `GET /v1/workforce/suggest/class/:id` · `…/session/:id`                          | staff (suggest only, nothing assigned)                            | `suggestForClass` / `suggestForSession`              |
| `GET /v1/admissions/leads` · `…/dashboard` · `…/options`                         | staff (leads at centers `admissions:manage` allows)               | `AdmissionsPort.listLeads` / `getDashboard`          |
| `GET /v1/admissions/counselors` · `…/settings`                                   | staff                                                             | `counselors` / `getSettings`                         |
| `POST /v1/admissions/leads` (a `LeadDraft`)                                      | staff with `admissions:manage` at the center                      | `createLead`                                         |
| `PUT /v1/admissions/leads/:id/assign` `{principalId}`                            | staff with `admissions:manage` at the lead's center               | `assign`                                             |
| `PUT /v1/admissions/leads/:id/stage` `{stage, reason?}`                          | staff with `admissions:manage` at the lead's center               | `moveStage`                                          |
| `POST /v1/admissions/leads/:id/activities` `{kind, text}`                        | staff with `admissions:manage` at the lead's center               | `logActivity`                                        |
| `PUT /v1/admissions/settings` (a `ScoringSettings`)                              | staff with `admissions:manage` (no center limit)                  | `updateSettings`                                     |
| `GET /v1/billing/years` · `…/fee-lines?year=` · `…/options`                      | staff                                                             | `BillingPort.years` / `listFeeLines`                 |
| `POST /v1/billing/fee-lines` (a `FeeLineDraft`)                                  | staff with `billing:manage` (all centers: no center limit)        | `proposeFeeLine`                                     |
| `POST /v1/billing/fee-lines/:id/approve` · `…/reject` · `…/retire`               | Org Admin, never their own proposal                               | `approveFeeLine` / `rejectFeeLine` / `retireFeeLine` |
| `GET /v1/billing/periods` · `…/invoices` · `…/payments` · `…/receivables`        | staff (invoices at centers `billing:manage` allows)               | `periods` / `listInvoices` / …                       |
| `POST /v1/billing/invoices/generate` `{year, period}`                            | staff with `billing:manage`                                       | `generateInvoices`                                   |
| `POST /v1/billing/invoices/first` `{leadId}`                                     | staff with `billing:manage` at the lead's center                  | `issueFirstInvoice`                                  |
| `POST /v1/billing/invoices/:id/payments` · `…/void`                              | staff with `billing:manage` at the invoice's center               | `recordPayment` / `voidInvoice`                      |
| `GET /v1/me/billing`                                                             | guardian, or a learner who pays their own                         | `getMine`                                            |
| `GET /v1/partners/overview` · `/v1/partners` · `…/entries` · `…/activity`        | staff with `partners:manage`                                      | `PartnersPort.getOverview` / `listPartners` / …      |
| `GET /v1/partners/suggest/:leadId`                                               | staff with `partners:manage` (ranked by fit, never by commission) | `suggestPartners`                                    |
| `POST /v1/partners/refer` `{leadId, partnerId}`                                  | `partners:manage` + `admissions:manage` at the lead's center      | `referLead`                                          |
| `POST /v1/partners/entries/:id/enrolled` · `…/reject` `{reason}`                 | staff with `partners:manage`                                      | `markEnrolled` / `reject`                            |
| `POST /v1/partners/entries/:id/approve`                                          | Org Admin, not the one who recorded the enrolment                 | `approve`                                            |
| `POST /v1/partners/:partnerId/rules` · `/v1/partners/rules/:id/activate\|reject` | staff propose; another Org Admin decides                          | `proposeRule` / `decideRule`                         |
| `POST /v1/partners/signals/act` `{signalId, action, note?}`                      | staff with `partners:manage`                                      | `actOnSignal`                                        |
| `GET /v1/partners/batches` · `…/batch-candidates` · `…/trends`                   | staff with `partners:manage`                                      | `listBatches` / `batchCandidates` / `getTrends`      |
| `POST /v1/partners/batches` `{partnerId, cycleLabel}`                            | staff with `partners:manage`                                      | `draftBatch`                                         |
| `POST /v1/partners/batches/:id/send`                                             | Org Admin who did not draft it                                    | `sendBatch`                                          |
| `POST /v1/partners/batches/:id/paid` `{paymentRef}` · `…/cancel` `{reason}`      | staff (a sent batch: an Org Admin cancels)                        | `markBatchPaid` / `cancelBatch`                      |
| `POST /v1/partners/:partnerId/report/preview` `{csv}` · `…/apply` (one row)      | staff with `partners:manage` (preview changes nothing)            | `previewReport` / `applyReportRow`                   |
| `GET /v1/courses` · `GET /v1/courses/:ref`                                       | teachers (own + published) and staff (every course of the org)    | `CourseAuthoringPort.list` / `get`                   |
| `POST /v1/courses` `{title, level}`                                              | teachers and staff with `courses:author`                          | `create`                                             |
| `POST /v1/courses/:ref/draft` `{content, baseRevision}`                          | a teacher their own course, staff any (`courses:author`)          | `saveDraft`                                          |
| `POST /v1/courses/:ref/submit` · `…/withdraw`                                    | who may edit it                                                   | `submit` / `withdraw`                                |
| `POST /v1/courses/:ref/approve` `{note?}` · `…/return` `{note}`                  | staff with `courses:author`, not the submitter nor a draft editor | `approve` / `returnForChanges`                       |
| `GET /v1/access/admin`                                                           | Org Admin (IIOS decides)                                          | `IiosPolicyAdminPort.getAdminView` → IIOS            |
| `POST /v1/access/policies` `{name, description, rules}`                          | Org Admin                                                         | `createPolicy` → IIOS                                |
| `PUT /v1/access/policies/:ref` `{expectedVersion, …}`                            | Org Admin, not a policy that restricts them                       | `revisePolicy` → IIOS                                |
| `POST /v1/access/policies/:ref/retire`                                           | Org Admin, not while in use                                       | `retirePolicy` → IIOS                                |
| `PUT /v1/access/members/:principalId/policy`                                     | Org Admin, never their own membership                             | `attachPolicy` → IIOS                                |

Schedule writes return the contract's `ScheduleResult` and attendance writes return `RecordAttendanceResult`; the HTTP status matches the outcome (404, 403, 409, 422).

## Make-ups

Make-up items are not stored. Every absent mark at a regular session of the learner's own class is an item (id `<missedSessionId>::<learnerId>`), derived on read, so none can be forgotten or deleted by hand. What is stored (migration 0003) is how an item is being made up:

- a booking (`makeup_booking`): joining another class of the same course for the same unit, or a make-up session;
- self-study (`makeup_selfstudy`).

An item closes when the learner is marked present or late at the booked session, or when the learner's own class teacher confirms the self-study. Booked guests appear on that session's attendance sheet with "make-up for <class>". A booking into a session that was later cancelled counts as open again.

Guardian ↔ learner links (`guardian_link`) come from the synthetic seed only. `ogc_app` may only read them; there is no path to create a link (D-14 stays closed).

## Workforce

Load is the teaching hours in the next 7 days, computed on read from the schedule:

- each session counts its class's real length;
- a substitute's session counts for the substitute;
- make-up sessions count.

Each teacher has a target in hours per week (`teacher_target`, migration 0004). Bands are a percentage of that target, with thresholds staff tune (`workforce_settings`, default 60 / 100). Suggestions rank candidates by fit, with any clash last. They assign nobody, and going over the target only warns. Not on the Platform yet: course-prep hours and the new-center wizard's hint.

## Admissions

One pipeline for every lead (migration 0005: `course`, `staff_member`, `lead`, `lead_history`, `lead_activity`, `admissions_settings`), with the demo's rules:

- a minimal synthetic profile: name, course, center, source, channel, needs and a short note. Phone numbers and e-mail addresses are refused;
- the score is five parts, each with its reason, and staff tune the points (they must add up to 100), the hot / warm thresholds and the stale days;
- a dashboard rate shows its numerator and denominator. "Reached" counts the furthest stage a lead ever reached, so a rate never exceeds 100%;
- staff move a lead by hand through new → assigned → contacted → placement → lost. "Offer" (first invoice issued) and "enrolled" (paid) are set only by Billing, through `attachFirstInvoice` / `markLeadPaid` in `domains/admissions.ts`, for the Billing slice;
- `ogc_app` may only insert into stage history and activities. Writes for an organization are serialised, so ADM numbers do not collide.

Not on the Platform yet: the first invoice (Billing) and "Refer to partner" (Partner Commissions).

## Billing

Fee plans, invoices, payments and receivables (migration 0006: `fee_line`, `invoice`, `invoice_line`, `payment`; `learner.pays_own_tuition`, `guardian_link.guardian_name`), with the demo's rules. SYNTHETIC: nothing is charged, paid or sent.

- Staff propose fee lines. An Org Admin approves, rejects or retires them, and never approves their own proposal. Only approved lines are invoiced, and an approved line is never edited.
- Generating is idempotent: one invoice per learner per fee line, ever, unless that invoice is voided. A center's own line beats an "all centers" line. An invoice is never due before 7 days after it is issued.
- A lead's first invoice (stage "placement") moves the lead to "offer". Paid in full, it moves to "enrolled" with the invoice amount; voided, it goes back to "placement". No learner is created (owner 23/11).
- Payments, invoice lines and fee amounts are append-only for `ogc_app`. An invoice with a payment is never voided. Overdue never blocks learning: it shows in Receivables only.
- The payer is the learner's guardian, or the learner when they pay their own. A minor sees no invoices.

Not on the Platform yet: the referral wallet (Growth), reminders, refunds, tax invoices.

## Partner Commissions

Leads handed to partner centers, tiered commissions, signals and an activity log (migration 0007: `partner`, `partner_rule`, `commission_entry`, `partner_activity`, `partner_signal_mark`), with the demo's rules. SYNTHETIC: a mock receivable, nothing is invoiced or paid.

- A lead goes out from Admissions ("Refer to partner") and closes there as "Referred to partner: <name>". Only a reference code (`LR-…`), a short display name and the course go to the partner. A lead is referred once.
- Suggestions are ranked by fit for the learner: the course taught, near the learner's center, retention. The commission is shown for information only and never used to rank.
- Staff record what the partner reports (enrolled within the attribution window, or rejected with a reason). An Org Admin approves after the clawback window, or the cycle end for a retroactive rule, and never approves an enrolment they recorded. Approving locks the amount.
- Staff propose a tier rule version; another Org Admin activates or rejects it. An enrolment keeps the version in force when it was recorded.
- Signals (near the next tier, stale referral, high rejection rate, overdue settlement) only suggest: follow, snooze for 7 days, or dismiss with a reason. Every step is appended to the activity log.

Part B (migration 0008: `settlement_batch`, `settlement_batch_entry`):

- Staff draft a settlement batch from the approved entries of one partner and enrolment cycle. An Org Admin who did not draft it sends it; it is then locked, and its due date replaces the approvals'. The partner pays the whole batch: staff record the payment reference and every entry becomes paid. A wrong batch is cancelled with a reason (a sent one only by an Org Admin), and its entries go back to "approved".
- A partner report (pasted `code,status,date,reason` lines) is previewed against the ledger: can be applied, already in the ledger, conflict (before the referral, after the attribution window, in the future, already approved / paid), unknown code, not valid. The preview changes nothing; a person applies one applicable row at a time, and it is checked again when applied.
- Trends: six months per partner by referral month — referred, enrolled, rejected, open, conversion with its counts, median days to enrol.

## Course Studio

Courses OGC writes itself (migration 0009: `authored_course`, `course_version`, `course_review`), with the demo's rules. SYNTHETIC content; no EduOS code or content. Part B links courses to classes and adds My Learning.

- A course is lessons, a lesson an ordered list of typed blocks (heading, text, callout, divider, vocabulary card, multiple-choice quiz, video link, reflection). The contracts' validator checks every save and refuses unknown kinds and fields; what is stored is rebuilt from the known fields only. A draft may be incomplete; a submission must be complete. A course is at most 200,000 characters (the draft route accepts bodies up to 512 KB).
- Saves carry the revision they started from; an older revision is refused (`conflict`). The same content in another key order is not a change.
- Draft → submit → a different person approves → a new published version. A teacher edits their own courses and reads the org's published ones (the published version, never someone else's draft). Staff edit every course of their org and approve, but never a course they submitted or a draft they edited since the last publication. A return needs a note.
- Published versions and review events are insert-only for `ogc_app`, and a trigger refuses any update to them, even by the owner role.

## Access policies

OGC-ADR-039 option C: IIOS stores and decides access policies; OGC keeps no copy and writes no authorization relation. The `/v1/access/*` routes present the caller's own grant to IIOS, which re-checks that the caller administers the organization and applies the rules (closed catalog, versions, append-only history, no self-change, fail-closed). The API adds the request id, idempotency for writes and an audit row per decision. IIOS answers are mapped to 200 / 403 `not_admin` / 404 `not_found` / 422 `invalid` (with `path`) / 409 for the other refusals. If IIOS cannot answer, the API returns 503 and stores nothing under the idempotency key. A policy attached here narrows the member's next request, because IIOS puts it in the grant's `narrowing`.

## Synthetic data

`DATABASE_URL_MIGRATE=… node dist/seed.mjs` loads the demo's organizations, centers, teachers, learners, classes, sessions and marks, run as the owner role. It refuses a database that already has data.

Sessions follow each class's weekly slot in center time (Asia/Ho_Chi_Minh), like the demo: A2 Morning on Mondays and Wednesdays at 09:00, both evening classes on Tuesdays and Thursdays at 18:00. Session ids count from the moment of seeding: `k1-m1` is the latest A2 Morning slot that has started (waiting for attendance), `k1-m2` and `k1-m3` are marked, `k1-p1` and `k1-p2` are the next two.

`node dist/seed.mjs --reset` (staging) deletes the two synthetic organizations' rows and seeds them again in one transaction. Other organizations are not touched. The audit log is append-only and is kept.

## Migrations

`migrations/NNNN_name.sql` files are forward-only. Never edit one after it is merged: the runner refuses a changed file. The `ogc_app` role must exist before the first migration runs.

## Tests

```bash
OGC_TEST_PG_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres pnpm --filter @ogc/api test
```

The admin URL is used only to create the test roles and a fresh database per file. Without it, the tests are skipped locally. In CI they fail instead of skipping.
