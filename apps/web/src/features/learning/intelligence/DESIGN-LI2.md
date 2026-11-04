# LI-2 design notes — taxonomy expansion & prerequisites

NON-PRODUCTION. These are **design** deliverables for AUTH-022 items 5 and 6. No code in
LI-2 changes an existing public contract; the items below are deferred because they would.

## 1. Forward-compatible skill taxonomy expansion (→ Reading, Writing, Listening, Speaking, Use of English)

**Current:** `Skill = reading | use_of_english | speaking` (3). Expanding to the full five
adds `writing` and `listening`.

**Why it is gated (not done in LI-2):** `LearnerProfile.skills` and `MasteryConfidence.skills`
are total maps built by the `skillMap` helper, which pins exactly the current keys. Widening
the enum changes the **shape** of these existing public types (profiles would carry five
entries) — a breaking change to an already-merged contract. Per AUTH-022 this requires
explicit approval, so it is specified here and left for its own additive-contract batch.

**Migration path (single, mechanical, low-risk):**
1. `profile.ts` — add `writing`, `listening` to the `Skill` enum; `skillMap` gains the two
   keys (one edit, one place).
2. `catalog`/`learning` — add `writing`, `listening` to `ActivityKind`; extend
   `SKILL_BY_KIND` and `ASSESSMENT_BY_KIND` (writing → subjective, listening → objective).
3. Engines (`mastery`, `recommend`, `confidence`) iterate `ALL_SKILLS` — **no logic change**,
   only the `ALL_SKILLS` constant and `skillLabel` switch gain two cases (compile-time caught).
4. Fixtures — placement seeds and activities add the two skills.

**Backward compatibility:** enum **widening** keeps all existing 3-skill data valid. The only
hard break is the profile/confidence map shape (3→5 keys) and any exhaustive `switch` on
`Skill`; both are compile-time surfaced. Recommendation: ship as a dedicated, owner-approved
batch — it is additive in spirit but alters an existing shape, which AUTH-022 holds for review.

## 2. Prerequisite awareness (item 5)

**Existing activity relationships:** `LearningActivity` carries `courseId`, `lessonId`,
`weight`, `kind` — there is **no** prerequisite/unlock edge (`prerequisiteIds`, `unlocks`,
ordering). `lessonId` groups activities within a lesson but does not express "must complete A
before B". The recommendation engine therefore has no relation to gate on.

**Conclusion → LI-3 dependency.** Prerequisite-gated recommendation cannot be implemented on
current data without fabricating relationships. It requires, as an additive step in LI-3:
- an additive `prerequisiteActivityIds: string[]` on `LearningActivity` (or a separate
  `PrerequisitePort`), plus deterministic fixtures; then
- `recommend`/`justify` can add an eligibility rule: an activity is recommendable only when
  its prerequisites are completed (or their skill mastery clears a threshold), surfaced as a
  new reason code (e.g. `blocked_prerequisite`).

Not implemented in LI-2 (would add a public contract field + fixtures) — captured here so LI-3
can pick it up without rediscovery.
