# LI-3 design notes — taxonomy compatibility review

NON-PRODUCTION. Addresses the AUTH-023 "Taxonomy compatibility" review item.

## Decision: keep the 3-skill union; do NOT widen in LI-3
The `Skill` union stays `reading | use_of_english | speaking`. Widening it to the proposed
five (Reading, Writing, Listening, Speaking, Use of English) changes the shape of the
already-merged `LearnerProfile.skills` and `MasteryConfidence.skills` total maps — a breaking
change to a public contract — so it remains **gated for separate approval** (migration path in
`DESIGN-LI2.md`).

## Why LI-3 is forward-compatible anyway
The prerequisite graph and path planner are **skill-agnostic**:
- `pathgraph.ts` operates purely on activity ids and prerequisite edges — it never references
  `Skill`.
- `pathplan.ts` uses `Skill` only to read `profile.skills[skill].level` /
  `confidence[skill].band` for display and to delegate ordering to the LI-1 `recommend`
  (which iterates `ALL_SKILLS`). No skill value is hard-coded.

Therefore a future 5-skill expansion needs **no change to LI-3 engines** — only the single
`ActivityKind → Skill` mapping (`skills.ts`), the `Skill` enum and the `skillMap` helper, as
already specified in `DESIGN-LI2.md`. The `ActivityKind → Skill` map remains the one
integration seam; adding `writing`/`listening` kinds is additive to it. A versioned contract
is not required — enum widening plus the mechanical map edit suffices, and is best shipped as
its own owner-approved additive batch.
