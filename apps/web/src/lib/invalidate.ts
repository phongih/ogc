import type { QueryClient } from "@tanstack/react-query";

/*
 * Any write that changes learning evidence or a teacher assignment ripples through mastery →
 * confidence → path → recommendation → next action → progress → teacher queues, across roles.
 * Keying each consumer separately went stale once (the practice result page showed the
 * pre-submit next step, 21/11). One rule instead: such writes refresh every learning-derived
 * query. Mock adapters only re-run active queries, so this stays cheap.
 */
export function refreshLearningState(qc: QueryClient): Promise<void> {
  return qc.invalidateQueries();
}
