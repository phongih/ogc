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

| Route                                                                                                                        | Who                                                               | Port it serves                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /v1/health`                                                                                                             | public                                                            | —                                                                              |
| `GET /v1/me/access`                                                                                                          | any grant                                                         | `MyAccessPort`                                                                 |
| `GET /v1/schedule`                                                                                                           | staff (`schedule:manage`, narrowed by center)                     | `SchedulePort.getOverview`                                                     |
| `POST /v1/sessions/:id/reschedule` `{at}`                                                                                    | staff                                                             | `reschedule`                                                                   |
| `POST /v1/sessions/:id/cancel` `{replacementAt}`                                                                             | staff                                                             | `cancelWithReplacement`                                                        |
| `POST /v1/classes/:id/sessions` `{title, at}`                                                                                | staff                                                             | `addSession`                                                                   |
| `PUT /v1/classes/:id/teacher` `{teacherId}`                                                                                  | staff (not if `classTeacher` is read-only)                        | `assignTeacher`                                                                |
| `PUT /v1/sessions/:id/substitute` `{teacherId \| null}`                                                                      | staff (not if `substitute` is read-only)                          | `setSubstitute`                                                                |
| `GET /v1/classes/:id/sessions`                                                                                               | the class teacher                                                 | `AttendancePort.listClassSessions`                                             |
| `GET` / `PUT /v1/sessions/:id/attendance`                                                                                    | owner or that session's substitute (`attendance:mark`)            | `getSessionAttendance` / `recordAttendance`                                    |
| `GET /v1/classes/:id/attendance-summary`                                                                                     | the class teacher                                                 | `getClassSummary`                                                              |
| `GET /v1/me/to-mark`                                                                                                         | teachers                                                          | `listToMark`                                                                   |
| `GET /v1/me/classes`                                                                                                         | teachers (403 `not_a_teacher` otherwise)                          | — (teacher home)                                                               |
| `GET /v1/dev/personas`, `POST /v1/dev/login`                                                                                 | public, only with `OGC_DEV_LOGIN=1` (staging)                     | — (mock IIOS issues the grant)                                                 |
| `GET /v1/makeups`                                                                                                            | staff (`makeup:manage`, narrowed by center)                       | `MakeupPort.getBoard`                                                          |
| `GET /v1/makeups/:item/options`                                                                                              | staff                                                             | `listOptions`                                                                  |
| `POST /v1/makeups/:item/book` `{sessionId}`                                                                                  | staff                                                             | `book`                                                                         |
| `POST /v1/makeups/:item/makeup-session` `{at, teacherId}`                                                                    | staff                                                             | `openMakeupSession`                                                            |
| `POST /v1/makeups/:item/self-study`                                                                                          | staff                                                             | `assignSelfStudy`                                                              |
| `GET /v1/me/makeups`                                                                                                         | learner (own) · guardian (linked, read-only)                      | `listMine`                                                                     |
| `POST /v1/me/makeups/:item/self-study` `{note}`                                                                              | learner (own item)                                                | `submitSelfStudy`                                                              |
| `GET /v1/me/makeups/to-confirm`                                                                                              | the learner's own class teacher                                   | `listToConfirm`                                                                |
| `POST /v1/makeups/:item/confirm` / `…/return` `{note}`                                                                       | the learner's own class teacher                                   | `confirmSelfStudy` / `returnSelfStudy`                                         |
| `GET /v1/workforce`                                                                                                          | staff                                                             | `WorkforcePort.getOverview`                                                    |
| `PUT /v1/workforce/teachers/:id/target`                                                                                      | staff with `workforce:manage`                                     | `setTarget`                                                                    |
| `PUT /v1/workforce/settings` `{underPct, overPct}`                                                                           | staff with `workforce:manage`                                     | `updateSettings`                                                               |
| `GET /v1/workforce/suggest/class/:id` · `…/session/:id`                                                                      | staff (suggest only, nothing assigned)                            | `suggestForClass` / `suggestForSession`                                        |
| `GET /v1/admissions/leads` · `…/dashboard` · `…/options`                                                                     | staff (leads at centers `admissions:manage` allows)               | `AdmissionsPort.listLeads` / `getDashboard`                                    |
| `GET /v1/admissions/counselors` · `…/settings`                                                                               | staff                                                             | `counselors` / `getSettings`                                                   |
| `POST /v1/admissions/leads` (a `LeadDraft`)                                                                                  | staff with `admissions:manage` at the center                      | `createLead`                                                                   |
| `PUT /v1/admissions/leads/:id/assign` `{principalId}`                                                                        | staff with `admissions:manage` at the lead's center               | `assign`                                                                       |
| `PUT /v1/admissions/leads/:id/stage` `{stage, reason?}`                                                                      | staff with `admissions:manage` at the lead's center               | `moveStage`                                                                    |
| `POST /v1/admissions/leads/:id/activities` `{kind, text}`                                                                    | staff with `admissions:manage` at the lead's center               | `logActivity`                                                                  |
| `PUT /v1/admissions/settings` (a `ScoringSettings`)                                                                          | staff with `admissions:manage` (no center limit)                  | `updateSettings`                                                               |
| `GET /v1/billing/years` · `…/fee-lines?year=` · `…/options`                                                                  | staff                                                             | `BillingPort.years` / `listFeeLines`                                           |
| `POST /v1/billing/fee-lines` (a `FeeLineDraft`)                                                                              | staff with `billing:manage` (all centers: no center limit)        | `proposeFeeLine`                                                               |
| `POST /v1/billing/fee-lines/:id/approve` · `…/reject` · `…/retire`                                                           | Org Admin, never their own proposal                               | `approveFeeLine` / `rejectFeeLine` / `retireFeeLine`                           |
| `GET /v1/billing/periods` · `…/invoices` · `…/payments` · `…/receivables`                                                    | staff (invoices at centers `billing:manage` allows)               | `periods` / `listInvoices` / …                                                 |
| `POST /v1/billing/invoices/generate` `{year, period}`                                                                        | staff with `billing:manage`                                       | `generateInvoices`                                                             |
| `POST /v1/billing/invoices/first` `{leadId}`                                                                                 | staff with `billing:manage` at the lead's center                  | `issueFirstInvoice`                                                            |
| `POST /v1/billing/invoices/:id/payments` · `…/void`                                                                          | staff with `billing:manage` at the invoice's center               | `recordPayment` / `voidInvoice`                                                |
| `GET /v1/me/billing`                                                                                                         | guardian, or a learner who pays their own                         | `getMine`                                                                      |
| `GET /v1/partners/overview` · `/v1/partners` · `…/entries` · `…/activity`                                                    | staff with `partners:manage`                                      | `PartnersPort.getOverview` / `listPartners` / …                                |
| `GET /v1/partners/suggest/:leadId`                                                                                           | staff with `partners:manage` (ranked by fit, never by commission) | `suggestPartners`                                                              |
| `POST /v1/partners/refer` `{leadId, partnerId}`                                                                              | `partners:manage` + `admissions:manage` at the lead's center      | `referLead`                                                                    |
| `POST /v1/partners/entries/:id/enrolled` · `…/reject` `{reason}`                                                             | staff with `partners:manage`                                      | `markEnrolled` / `reject`                                                      |
| `POST /v1/partners/entries/:id/approve`                                                                                      | Org Admin, not the one who recorded the enrolment                 | `approve`                                                                      |
| `POST /v1/partners/:partnerId/rules` · `/v1/partners/rules/:id/activate\|reject`                                             | staff propose; another Org Admin decides                          | `proposeRule` / `decideRule`                                                   |
| `POST /v1/partners/signals/act` `{signalId, action, note?}`                                                                  | staff with `partners:manage`                                      | `actOnSignal`                                                                  |
| `GET /v1/partners/batches` · `…/batch-candidates` · `…/trends`                                                               | staff with `partners:manage`                                      | `listBatches` / `batchCandidates` / `getTrends`                                |
| `POST /v1/partners/batches` `{partnerId, cycleLabel}`                                                                        | staff with `partners:manage`                                      | `draftBatch`                                                                   |
| `POST /v1/partners/batches/:id/send`                                                                                         | Org Admin who did not draft it                                    | `sendBatch`                                                                    |
| `POST /v1/partners/batches/:id/paid` `{paymentRef}` · `…/cancel` `{reason}`                                                  | staff (a sent batch: an Org Admin cancels)                        | `markBatchPaid` / `cancelBatch`                                                |
| `POST /v1/partners/:partnerId/report/preview` `{csv}` · `…/apply` (one row)                                                  | staff with `partners:manage` (preview changes nothing)            | `previewReport` / `applyReportRow`                                             |
| `GET /v1/courses` · `GET /v1/courses/:ref`                                                                                   | teachers (own + published) and staff (every course of the org)    | `CourseAuthoringPort.list` / `get`                                             |
| `POST /v1/courses` `{title, level}`                                                                                          | teachers and staff with `courses:author`                          | `create`                                                                       |
| `POST /v1/courses/:ref/draft` `{content, baseRevision}`                                                                      | a teacher their own course, staff any (`courses:author`)          | `saveDraft`                                                                    |
| `POST /v1/courses/:ref/submit` · `…/withdraw`                                                                                | who may edit it                                                   | `submit` / `withdraw`                                                          |
| `POST /v1/courses/:ref/approve` `{note?}` · `…/return` `{note}`                                                              | staff with `courses:author`, not the submitter nor a draft editor | `approve` / `returnForChanges`                                                 |
| `GET /v1/class-courses` · `…/search?q=` · `…/:id/progress`                                                                   | staff with `courses:link` (their centers), class teachers (own)   | `StudioLinksPort.getOverview` / `searchCourses` / `progress`                   |
| `POST /v1/class-courses/propose` `{classId, courseRef}`                                                                      | the class teacher                                                 | `propose`                                                                      |
| `POST /v1/class-courses/link` `{classId, courseRef, prepHoursPerWeek}`                                                       | staff with `courses:link` at the class's center                   | `link`                                                                         |
| `POST /v1/class-courses/:id/reject\|unlink` `{reason}` · `…/prep` `{hours}`                                                  | staff with `courses:link` at the class's center                   | `reject` / `unlink` / `setPrepHours`                                           |
| `GET /v1/me/class-courses` · `…/:ref/:lessonId` · `POST …/:ref/:lessonId/complete`                                           | the learner (self)                                                | `ClassCoursePlayerPort.mine` / `lesson` / `complete`                           |
| `POST /v1/me/class-courses/:ref/:lessonId/speaking/:blockId` `{choices}`                                                     | the learner, when the teacher returned the latest attempt         | try a speaking rehearsal again                                                 |
| `GET /v1/speaking-reviews`                                                                                                   | the class teacher (reviews), staff with `courses:link` (see only) | the pending speaking rehearsals                                                |
| `POST /v1/speaking-reviews/decide` `{learnerId, ref, lessonId, blockId, attempt, decision, note?}`                           | the learner's class teacher only; `return` needs a note           | approve / return                                                               |
| `GET /v1/me/referrals`                                                                                                       | a guardian or an adult learner (self)                             | `GrowthPort.getMine`                                                           |
| `GET /v1/growth/leads` · `…/program` · `…/metrics` · `POST /v1/growth/leads/:id/confirm\|reject` · `POST /v1/growth/program` | staff (writes: `growth:manage`)                                   | `listLeads` / `getProgram` / `confirm` / `reject`                              |
| `GET /v1/public/referrals/:code` · `POST …/:code/leads` (no grant)                                                           | anyone with a code — rate-limited                                 | `recordClick` / `submitLead`                                                   |
| `GET /v1/students`                                                                                                           | staff (`students:view` by center), class teachers (own classes)   | `StudentsPort.list`                                                            |
| `GET /v1/me/skills`                                                                                                          | the learner (self)                                                | `LearningProfilePort.getProfile`                                               |
| `GET /v1/engine/rules` · `…/events` · `…/actions` · `…/job`                                                                  | staff (events / actions run the engine first when stale)          | `DecisionEnginePort.listRules` / `listEvents` / `listActions` / `getJobStatus` |
| `POST /v1/engine/rules/:id` `{enabled?, priority?, cooldownMin?, params?, actions?}`                                         | staff with `engine:manage` (actions may be read-only)             | `updateRule`                                                                   |
| `POST /v1/engine/run`                                                                                                        | staff                                                             | `runNow`                                                                       |
| `GET /v1/me/notifications` · `POST /v1/me/notifications/:id\|all/read`                                                       | staff (center staff inbox), teachers (their own)                  | `listNotifications` / `markRead`                                               |
| `GET /v1/access/admin`                                                                                                       | Org Admin (IIOS decides)                                          | `IiosPolicyAdminPort.getAdminView` → IIOS                                      |
| `POST /v1/access/policies` `{name, description, rules}`                                                                      | Org Admin                                                         | `createPolicy` → IIOS                                                          |
| `PUT /v1/access/policies/:ref` `{expectedVersion, …}`                                                                        | Org Admin, not a policy that restricts them                       | `revisePolicy` → IIOS                                                          |
| `POST /v1/access/policies/:ref/retire`                                                                                       | Org Admin, not while in use                                       | `retirePolicy` → IIOS                                                          |
| `PUT /v1/access/members/:principalId/policy`                                                                                 | Org Admin, never their own membership                             | `attachPolicy` → IIOS                                                          |

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

Part B (migration 0010: `class_course_link`, `course_progress`, `course_lesson_done`):

- A class follows one course with a published version. The class teacher proposes it; staff with `courses:link` at the class's center link it (the proposal becomes the link), or reject or unlink it with a reason. Weekly prep hours on a link (0–10, half hours) count for the class teacher in Workforce as "Course prep".
- A learner of the class takes the course in My courses, pinned to the version of their first completed lesson. Quiz answers stay hidden until the lesson is completed; every question and reflection must be answered. A completed lesson and the pin are final: insert-only for `ogc_app`, and a trigger refuses updates.
- Staff and the class teacher see each learner's completion: lessons completed of the version they are on, and the last activity.

## Speaking review

Migration 0013: `course_speaking_attempt`, and `course_lesson_done.speaking` (the replies chosen). Owner decisions 23/11.

- A speaking rehearsal is a Course Studio block (`speaking`): a scenario and 1–8 turns, each with the coach's line, 2–4 replies (one marked natural), a model line and a tip. The natural reply, model line and tip stay hidden until the lesson is completed.
- Completing the lesson needs a reply at every turn and submits the rehearsal (attempt 1, pending, scored as % natural replies). It counts for Speaking only once the learner's class teacher approves it. The teacher may return it with a note (3–300 characters); the learner then sends it again (attempt 2, …). Center staff see the queue but do not review.
- A review is decided once: `ogc_app` may only update the review columns, and a trigger refuses any other change or a second decision. One attempt waits per block (a partial unique index).
- An approved attempt is Speaking evidence in the skill profile and Current Students. A block whose latest attempt was returned is "watch" evidence and fires the Decision Engine's "speaking returned" rule (a paused rule shows and fires nothing).
- The seed puts the demo script "Describe your weekend" in "Making plans" (A2 v2) and one pending rehearsal from Linh for Tara. The demo keeps its own Speaking studio; there is no review in the demo.

## Skill profile and Current Students

Migration 0011: `placement_result` (the demo's synthetic placement per learner, loaded by the seed; read-only for `ogc_app`).

- A learner's profile is the placement seed with assessed evidence folded in by the shared, pure mastery logic in `@ogc/contracts` (`mastery.ts`, moved there from the web app so the demo and the API run the same code). On the Platform the evidence is the quiz score of each completed class-course lesson (Use of English) and each speaking rehearsal the class teacher approved (Speaking).
- Current Students gives each learner one of three care levels — OK, Watch, Needs support — always with the evidence behind it and never a psychological label: a low or dropping skill (with its source: placement test only or class-course quizzes), absences in a row, attended below 80% of at least 3 marked sessions, a make-up whose deadline is close or past. Staff see the learners of their `students:view` centers, a class teacher those of their own classes; learners and guardians do not. Overdue tuition is shown to staff with `billing:manage` for information only and never changes the level. Suggestions are for people; nothing acts on its own.
- Thresholds come from the Decision Engine's rules (skill below, drop of, absences in a row, make-up deadline within); a paused rule shows no evidence. Without rules (a fresh organization) the defaults apply: 60, 5, 2, 3 days.
- A speaking rehearsal the class teacher returned is "watch" evidence. Not on the Platform: practice attempts, so there is no "no practice" evidence yet.

## Decision Engine

Migration 0012: `engine_rule`, `engine_event`, `engine_action`, `engine_fired` (cooldown state), `engine_notification`, `engine_job`. The demo's rules (owner decisions 21/11).

- Observe → Detect → Decide (cooldown per rule and subject) → Act. Actions are limited to a log entry, an in-app notification to the class teacher or center staff, and the "learners needing support" list (shown in Current Students). The engine never assigns work, changes a score or moves a lesson. Every event states its evidence.
- The rule set is fixed (`DEFAULT_ENGINE_RULES` in `@ogc/contracts`, shared with the demo and loaded by the seed). Staff with `engine:manage` turn a rule on or off and tune its priority, cooldown, thresholds (within each rule's range) and actions; a policy can make actions read-only. Only learner rules can use the support list.
- It runs when a staff or teacher page reads events, actions or notifications and the last run is older than 60 s (owner 23/11: no background service). Runs are serialised per organization with an advisory lock and a re-check, so pages asking at the same moment start one run. Staff can also "Run now".
- Events and actions are insert-only for `ogc_app`, and a trigger refuses updates.
- Detected on the Platform: skill below / dropped (placement + class-course quizzes), absences in a row, make-up deadline close / passed / missed again, attendance not taken, teacher load, class without a teacher, invoice overdue, no class-course activity, speaking returned. Not yet (no data on the Platform): no practice — the rule detects nothing.

## Growth · referrals

Migration 0014: `referral_code` (a public directory code → organization), `referral_program`, `referral_campaign`, `referral_click`, `referral_reward`, `wallet_entry`; `learner.adult`; `lead.referrer_principal_id` / `referral_code`; invoices may carry wallet credit. Owner decisions 22/11 (demo) and 23/11.

- Guardians and adult learners get a link / code; a learner under 18 has none.
- The public `/join` page (no grant) records a click and takes a display name, a course and a center — no contact details. It is rate-limited in memory per address (from nginx's `X-Forwarded-For`; addresses are not stored), per code and per organization. The lead enters the one Admissions pipeline as a referral.
- A referral counts when its first invoice is paid in full (Admissions "enrolled") and staff with `growth:manage` confirm it. Confirming is refused while an anti-fraud flag stands: self-referral, same household, duplicate (a learner or an open lead with the same name at that center), already rewarded. Names are compared without case, punctuation or Vietnamese diacritics. A reward is decided once (insert-only, trigger).
- The reward is wallet credit: (program % + active campaign %) of the first payment, capped. Billing applies waiting credit to the payer's invoices issued later (never more than the invoice); voiding such an invoice gives it back. Wallet entries are append-only.
- The seed: program 5 %, cap 2.000.000 ₫, Tết 2027 +2 %; Minh is an adult learner; Mai referred Bao T. (first invoice paid, waiting for confirmation) and "Linh N." (her own child — flagged).
- Part B: `GET /v1/growth/metrics` (staff: K-factor = confirmed referrals per referrer, cohorts by month of the lead, campaigns, top referrers, an LTV proxy — first payment vs the approved tuition of the course) and `POST /v1/growth/program` (`growth:manage`: on / off, 0–30 % with one decimal, cap 0–50.000.000 ₫, campaign on / off and 0–20 % bonus; the campaign list is fixed; a partial change keeps the rest; the reward uses the program at the moment of confirming).

## Public course showcase

Migration 0015: `public_org` (a public directory slug → organization, written by the owner role only), `course_showcase` (per course, outside its versions), `lead.origin`. Owner decisions 23/11.

- Staff with `courses:author` set a course's showcase: on / off (only with a published version), the offer (Free / Trial / Paid), the catalog course enquiries are for (required when public) and the learning needs it serves (`GET`/`POST /v1/courses/:ref/showcase`). The published content is never touched; the public sees the latest published version, lesson titles only.
- Public, no grant: `GET /v1/public/showcase` (organizations with courses on show), `GET /v1/public/showcase/:slug?level=&needs=&center=` and `GET …/courses/:ref`. Courses are ranked by fit for what the visitor chose — level 40, a shared need 30, a class at the chosen center 30 — with the reasons shown; price, offer and commission never rank, and nothing the visitor chose is stored. Paid (and Trial, "then") shows "from X ₫ / term" from the approved tuition of the catalog course; nothing is sold online.
- `POST …/courses/:ref/enquiries`: a display name, a center, needs and the kind (consultation, or a trial lesson for a Trial course) — no contact details — rate-limited like `/join`. It creates an Admissions lead (source "website") with its origin, e.g. "Showcase · CS-A2-EVERYDAY v2 · Trial · trial lesson", audited as `showcase:enquiry`. Nothing goes to a partner from here: staff refer a lead from Admissions.
- The seed shows A2 Everyday English (Trial, ENG-A2), B1 Speaking Confidence (Paid, ENG-B1) and IELTS Writing Task 1 (Free, IELTS-B2) for Nova Learning (`nova-learning`); Lumen Edu (`lumen-edu`) shows nothing.

## Brand & provider profile

Migration 0016: `brand_profile` (one per organization), `teacher_profile` (a teacher's own opt-in), `credential` (organization or teacher badges; decisions made once, maker-checker in a table check, moves limited by a trigger). Owner decisions 24/11. Synthetic data only: fictional issuers, and the Credly check is a fake register.

- Staff with the new closed action `brand:manage` edit the public profile (`POST /v1/brand/profile`: tagline ≤ 120, about ≤ 1200, colors `#rrggbb`; no phone numbers, e-mail addresses or links, because visitors enquire through the course form), add organization badges (`POST /v1/brand/credentials`) and verify / reject / withdraw badges (`POST /v1/brand/credentials/:id/verify|reject|withdraw`). `GET /v1/brand` is the staff view, with each teacher's choice shown read-only.
- Maker-checker: the person who added a badge never verifies or rejects it (403 `maker_checker`). A Credly badge is verified only when the `CredentialVerifier` says `valid`. In staging that is `fakeCredly` (`MOCK-…` valid, `…-R` revoked, `…-X` expired, anything else unknown; no network). A professional certificate needs `{ seen: true }`. An expired badge cannot be verified. A real Credly connection is later work behind its own gate.
- A teacher manages only their own profile (`GET`/`POST /v1/me/public-profile`: on / off, display name 2–40, bio ≤ 400, no contact details, no photo) and their own badges (`POST /v1/me/public-profile/credentials`, `…/:id/withdraw`). Staff cannot publish a teacher. Turning the profile off removes it from the public pages at once.
- Public, no grant: `GET /v1/public/showcase/:slug/profile` (tagline, about, colors, centers, verified unexpired organization badges, opted-in teachers with their verified badges, number of courses shown). A course page (`…/courses/:ref`) adds the provider block and the opted-in teachers of the classes that run its catalog course. Who added or verified a badge is never public. Partners are not shown.
- Seed (Nova): profile and colors; CR-1 verified (Credly mock), CR-2 a certificate waiting for verification, CR-3 Tara verified, CR-4 Tara revoked at the mock register (waiting), CR-5 Ben verified. Tara is public; Ben is not.

## Course Studio blocks (part A)

Owner decisions 24/11 (no migration). The block registry (`@ogc/contracts` `BLOCK_REGISTRY`) has 15 kinds (with `mission_box`, below); every one is validated fail-closed in "draft" and "submit" modes, nested items included (unknown fields refused at every level).

- `image` (https link, caption, credit) and `book_page` (title + 1–12 pages of heading and text, read one page at a time).
- `vocab` is now a deck: a title and 1–12 cards (word, meaning, example, translation, https image link). An older single-card block — still in published versions, which never change — is valid and reads as a deck of one (`normalizeBlock`); a draft saved again stores the new form.
- `practice` (1–10 multiple-choice questions), `eagle_match` (2–8 left–right pairs) and `time_detective` (3–8 events written in the right order) are scored for XP only ("Practice scored", a second line "… · practice N%") — never skill evidence: only the `quiz` block feeds Use of English, as before.
- Before a lesson is completed the learner's view hides every answer: practice `correct` −1, match `right` blanked with the right-hand items given separately as `choices`, detective events reordered. The shown order is alphabetical, reversed if that happens to be the answer's order, so it never gives the answer away. Completing needs every practice answer (`practice`: block id → the option per question / the chosen right-hand item per pair, each once / the shown events' order); the answers are stored with the quiz answers (arrays) and the completed view returns `practice` and `practiceScore`.

### Mission Box

Migration 0018 (owner 24/11, part B): `course_mission_attempt`. A `mission_box` block (title, task, why it matters) is a real-world task, reviewed like a speaking rehearsal but never skill evidence.

- Completing a lesson needs every mission confirmed (`missions`: block id → the learner's note, '' allowed, ≤300); each one becomes attempt 1, waiting for the class teacher. The lesson view returns `missions` (the latest attempt per block).
- `GET /v1/mission-reviews`: the waiting missions of the caller's classes (`mayReview` only for the class teacher; staff see the queue). `POST /v1/mission-reviews/decide`: approve, or return with a note (3–300) — only the teacher of the learner's class, only the waiting attempt; audited (`courses:review_mission`).
- `POST /v1/me/class-courses/:ref/:lessonId/mission/:blockId`: send a returned mission again with a new note (the next attempt).
- The database decides a review once (trigger), allows one waiting attempt per block, requires a note on a return, and lets the app change only the review columns.
- An approval earns XP through the new reward "Mission approved" (+20 by default, tunable with `rewards:manage`) and the Explorer badge — nothing reaches the skill profile, Students or the Engine. The demo stores the confirmed notes and has no review.

## Gamification

Migration 0017: `reward_settings`, `reward_rule`, `badge_rule` — only the organization's settings within the closed catalog (an organization without rows uses the defaults). Owner decisions 22/11 (demo) and 24/11 (Platform). The rules live in `@ogc/contracts` (`deriveRewards`, `streakOf`, `rankClass`, `gamificationView`, `applyGamificationUpdate`); the demo uses the same functions.

- Rewards are derived from learning evidence on every read; nothing records XP, nothing is awarded by hand, nothing counts logging in. Evidence: a completed class-course lesson (activity, +10) and its quiz score (scored practice, up to +20 at 100%), a speaking rehearsal the class teacher approved (+25), a make-up done — attended, or self-study confirmed (+15), a mission the class teacher approved (+20), and the XP of practice blocks. Every reward line names its evidence ("Making plans · scored 100%").
- XP + level (100 XP per level), a streak of learning days in center time (Asia/Ho_Chi_Minh; it still stands if the last learning day was yesterday), badges (First step, Perfect score, Heard you, Caught up — before the deadline, Learning streak 7 days, Level up 5, Explorer), a weekly leaderboard of the learner's class (equal XP share a rank).
- `GET /v1/me/rewards`: a learner their own; a guardian each linked child, with the child's rank but no classmates' names. Teachers and staff → 403 (they keep seeing evidence only).
- `GET /v1/rewards/settings` (staff), `POST /v1/rewards/settings` (staff with `rewards:manage`): enable / XP 0–100 per reward, enable / threshold 1–365 per badge (only streak and level have one), XP per level 10–1000, leaderboard on / off. Unknown fields or kinds are refused; a partial change keeps the rest; audited.

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
