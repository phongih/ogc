# OGC-EDUOS-LS-001 — Learning Studio ↔ OGC integration

- **Status:** Proposed — specification only. Nothing here is approved for implementation, on either side.
- **Date:** 22/11/2026
- **Decides:** the owner; the EduOS team for everything inside EduOS; IIOS where IIOS is named. This document lists what is needed and the options; where a choice is open it says so.
- **Owner decisions already taken (22/11, OGC wave 71):** direction 1 — _link, do not rebuild_; only completion comes back; the class teacher proposes, center staff link (`courses:link`); prep hours on a link count in Workforce. Implemented as a **mock** in OGC PR #63 (`lib/integration/mockLearningStudio.ts`, `lib/adapters/mockStudioLinks.ts`).
- **Inputs (read-only survey of the EduOS backend worktree `~/wt-p1merge`, commit `18a0492` "merge main (77448bf billing fix) into feat/phase1-branch-scope", 22/11):**
  - `docs/adr/ADR-054_Learning_Studio_LMS.md` (Accepted 16/10/2026) incl. §8 L1-H hardening H1–H3;
  - route list of `src/modules/lms/lms.routes.js`;
  - route list of `src/modules/partner/partner.routes.js`, `openapi.routes.js`; scope / tenant lines of `middleware/apikey.middleware.js`; event lines of `webhook.service.js`;
  - table and column lines of migrations `120_lms_learning_studio_v0.sql`, `123_lms_learner_enrollment.sql`.

  Only structure was read (route signatures, column names). No data, no secrets, no source is copied into OGC.

> **Non-claims.** OGC is a static SPA with mock adapters and synthetic data. This document is not evidence that any integration exists, is secure, or is compliant. Whether moving learners' progress (including minors') between systems is permitted, and under what consent, is a question for the owner / IIOS / legal review (Track C) — not answered here. G2-C, 33.S, D-14, R-06 / R-16, DEC-010 and 009B are unchanged.

---

## 1. What OGC needs — and never needs

| OGC needs                                                                                                                                                               | Why                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| The organization's Learning Studio courses that have a published version: id, title, lesson count, status, current publication, updated time, a link to open the course | Staff / teachers pick a course to link to a class                                          |
| Per learner of a linked class: lessons completed of the publication they learn, total lessons of that publication, last activity, completed time                        | Current Students line; Decision Engine rule "No Learning Studio activity" (off by default) |
| _(optional)_ a push when a learner completes a lesson                                                                                                                   | Fresher data without polling                                                               |
| _(optional)_ a way to give a class's learners access to the course                                                                                                      | Otherwise a teacher assigns in Learning Studio by hand (§5)                                |

**OGC never needs, and must not receive:** lesson / block content, quiz questions or answers, quiz scores, reflections, uploaded media, reviewer comments, analytics beyond the four completion fields, any learner field other than the shared identity (§3).

---

## 2. What EduOS already has (survey, 22/11)

| Capability                                                                                                                                                                                                                                            | Where                                                    | Fit                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Partner API with per-key scopes, IP allow-list, rate limit; `school_id` taken from the key, **not** from the client; every call logged (`school_id, api_key_id, endpoint, method, status_code, ip_address, request_id, response_ms, accessed_entity`) | `modules/partner/middleware/apikey.middleware.js`        | Exactly the frame needed — add LMS endpoints here |
| Partner endpoints today: `GET /students`, `/students/:id` (`students.read`), `/admissions`, `/attendance`, `/grades` (each its own scope), `/me`; `GET /openapi.json`, `/docs`                                                                        | `partner.routes.js`, `openapi.routes.js`                 | **No LMS endpoint yet**                           |
| Signed webhooks: `queueEvent(schoolId, eventType, payload)` → `integrations.webhook_deliveries`, POST with `X-EduOS-Signature`, `X-EduOS-Event`, `X-EduOS-Delivery`, retries                                                                          | `webhook.service.js`                                     | Reuse for `lms.lesson.completed`                  |
| Courses with immutable publications (`lms.courses.current_publication_id`, `lms.course_publications` snapshot, UPDATE/DELETE blocked — ADR-054 H2)                                                                                                    | migration 120                                            | Lesson count per publication is stable            |
| Enrollment per person and publication: `lms.enrollments (school_id, course_id, person_id, publication_id, started_at, completed_at, last_activity_at)`                                                                                                | migration 123                                            | All completion fields exist                       |
| Lesson completion: `lms.lesson_progress (school_id, enrollment_id, lesson_id, completed_at)`                                                                                                                                                          | migration 123                                            | Count → "lessons completed"                       |
| Assignment: `lms.assignments (school_id, course_id, target_person_id                                                                                                                                                                                  | target_class_id …, assigned_by → core.users, revoked_*)` | migration 123                                     | Option (a) of §5 |
| Internal routes (session + capability): `GET /courses/:id/progress` (WRITE), `/learn/*` (learner) …                                                                                                                                                   | `lms.routes.js`                                          | **Not** for OGC — internal auth, wider data       |

Note: `~/wt-p1merge` is a worktree on a feature-merge commit. **The EduOS team must confirm the same routes and columns on the deployed production build** before work starts.

---

## 3. Identity and tenant — must be settled first

- **Learner identity.** EduOS keys learners by `core.persons.person_id` (ADR-054 D3). OGC knows learners only through IIOS principals (OGC-ADR-039). A mapping `person_id ↔ IIOS principal` is required. **Proposal:** IIOS holds it (it already decides who a principal is); neither OGC nor EduOS stores the other's id. _Open — IIOS / owner._
- **Tenant.** EduOS partitions by `school_id` (every `lms.*` row, ADR-054 H1); OGC by organization (and center inside it). **Proposal:** one OGC organization ↔ one EduOS `school_id`, recorded in IIOS (or in the API key, §4). Cross-tenant reads are refused on both sides. _Open — owner._
- **Classes.** EduOS classes (`target_class_id`) are not OGC classes. OGC never sends an OGC class id to EduOS; it sends people (§5 a) or nothing (§5 b).

---

## 4. How OGC calls EduOS — an open choice

OGC today is a **static SPA**: a partner API key cannot live in the browser. Two options:

|                       | (A) Thin OGC backend holds the key                                      | (B) IIOS brokers the call                                                                                    |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| How                   | A small OGC server keeps one partner API key per tenant and calls EduOS | OGC calls IIOS with its existing grant; IIOS calls the EduOS partner API and returns only the allowed fields |
| Fits OGC-ADR-039      | Needs a backend — touches the held items (009B, ADR-039 F5/F6)          | Matches F1 option C (IIOS decides and brokers)                                                               |
| Identity mapping (§3) | OGC backend must hold or ask for the mapping                            | IIOS already holds it                                                                                        |
| Audit                 | EduOS partner log + OGC backend log                                     | EduOS partner log + IIOS log                                                                                 |
| Work                  | OGC backend + key custody                                               | IIOS endpoint                                                                                                |

_Open — owner / IIOS._ The EduOS endpoints in §6 are the same for both.

---

## 5. Access to the course — an open choice

Linking a course to a class in OGC does **not** by itself let learners open it in Learning Studio.

- **(a) OGC assigns through the API** — scope `lms.assign`: after staff link a course, OGC (via A or B) sends the class's learners as `person_id`s; EduOS writes `lms.assignments` with `target_person_id`, `assigned_by` = a service user of the key. Unlink revokes (`revoked_by/at`). Needs: the service user, idempotency (same course + person twice = no new row), and a decision on who may revoke an assignment made in EduOS by a teacher.
- **(b) The teacher assigns in Learning Studio** — OGC only reads completion. Simpler; the class list may drift from OGC's roster.

_Open — owner._ OGC's mock currently behaves like (b).

---

## 6. Proposed EduOS partner endpoints

All under the existing partner API (`X-API-Key`, school from the key, access logged), JSON, read-only unless stated.

### 6.1 `GET /lms/courses` — scope `lms.read`

Query: `status=published` (default: courses with a current publication), `q`, `updated_since`, paging as other partner endpoints.

```json
{
  "data": [
    {
      "id": "uuid",
      "title": "A2 Everyday English — Units 6–8",
      "status": "published",
      "has_unpublished_changes": false,
      "current_publication": {
        "id": "uuid",
        "publication_no": 6,
        "lesson_count": 6,
        "published_at": "…"
      },
      "updated_at": "…",
      "open_url": "https://<school host>/learning-studio/courses/<id>"
    }
  ]
}
```

`lesson_count` comes from the publication snapshot, not the draft. Archived courses and courses never published are not returned unless `status=all`.

### 6.2 `GET /lms/courses/:id/progress` — scope `lms.progress.read`

Query: `person_ids` (required, ≤ 200 — only learners the caller already knows; no listing of everyone enrolled).

```json
{
  "course_id": "uuid",
  "data": [
    {
      "person_id": "uuid",
      "enrolled": true,
      "publication_id": "uuid",
      "lessons_completed": 3,
      "lessons_total": 6,
      "started_at": "…",
      "last_activity_at": "…",
      "completed_at": null
    }
  ]
}
```

- `lessons_total` = lessons of the **publication the learner is enrolled in** (enrollments stay pinned, ADR-054 H2).
- A person not enrolled → `enrolled: false`, other fields null. Unknown or other-school person → omitted (no error that reveals existence).
- No other learner fields.

### 6.3 Webhook `lms.lesson.completed` _(optional)_

Emitted with `queueEvent` from the lesson-complete route. Payload — the same fields as one row of 6.2, plus `course_id`, `lesson_id`, `completed_at`. No lesson content.

### 6.4 `POST /lms/courses/:id/assignments` — scope `lms.assign` _(only for §5 a)_

Body `{ "person_ids": [...], "idempotency_key": "…" }` → creates missing `lms.assignments` rows (target_person_id), returns created / already-assigned counts. `DELETE` counterpart revokes rows this key created.

### 6.5 Error and limits

Reuse the partner API: 401 bad key, 403 missing scope (`required: [...]`), 429 rate limit, `request_id` on every response. Scopes are separate so a key can read courses without reading progress.

---

## 7. What changes in OGC when it is real

- Replace `lib/integration/mockLearningStudio.ts` with a client for 6.1 / 6.2 (through A or B); `StudioCourse` already carries `ref`, `title`, `lessons`, `status`, `updatedAt`, `url`, `linkable`. Map `status=published` + `has_unpublished_changes` → OGC's `published` / `unpublished_changes`.
- `LearnerStudioProgress` already matches 6.2 (`completedLessons`, `totalLessons`, `lastActivityAt`); OGC resolves `learnerId ↔ person_id` through IIOS (§3).
- Nothing in the OGC UI, permissions (`courses:link`), Workforce prep hours or the engine rule needs to change.

---

## 8. Open questions (for the owner / EduOS / IIOS)

1. §3 — who holds `person_id ↔ IIOS principal`; one OGC organization ↔ one `school_id`?
2. §4 — (A) thin OGC backend or (B) IIOS broker?
3. §5 — (a) OGC assigns through the API or (b) teachers assign in Learning Studio?
4. Confirm §2 on the deployed EduOS build (not only `wt-p1merge`).
5. Consent / data-protection review for progress of learners under 18 moving between systems (Track C) — outside Claude's scope.
6. Polling interval if no webhook (proposal: on page open + at most every 15 min per class).
