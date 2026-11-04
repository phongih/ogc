import type { ActivityPrerequisite, GraphIssue, GraphValidation, LearningActivity } from "@ogc/contracts";

/*
 * LI-3 — Pure prerequisite-graph engine. No React, no I/O, no RNG.
 *
 * Validates a prerequisite relation over a learner's in-scope activities and produces a
 * deterministic topological order. Every integrity problem fails CLOSED: cycles, missing
 * references, cross-org references and the activities transitively depending on them are all
 * reported so the planner can keep them permanently blocked.
 */

export interface GraphInput {
  activities: readonly LearningActivity[]; // scoped to one tenant
  edges: readonly ActivityPrerequisite[]; // dependent activityId expected in scope
  foreignActivityIds: ReadonlySet<string>; // ids that exist but belong to ANOTHER tenant
}

// Intra-scope prerequisite map: activityId → the required ids that are themselves in scope.
export function intraPrereqs(input: GraphInput): Map<string, string[]> {
  const scoped = new Set(input.activities.map((a) => a.id));
  const m = new Map<string, string[]>();
  for (const e of input.edges) {
    if (!scoped.has(e.activityId)) continue;
    const intra = e.requiresActivityIds.filter((r) => scoped.has(r));
    m.set(e.activityId, intra);
  }
  return m;
}

// Tarjan SCC → any component with >1 node (or a self-loop) is a cycle.
function cycleNodes(nodes: string[], deps: Map<string, string[]>): Set<string> {
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cyclic = new Set<string>();

  const strongconnect = (v: string) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) for (const n of comp) cyclic.add(n);
      // self-loop (v depends on v) is a 1-node cycle.
      if (comp.length === 1 && (deps.get(v) ?? []).includes(v)) cyclic.add(v);
    }
  };

  for (const n of [...nodes].sort()) if (!idx.has(n)) strongconnect(n);
  return cyclic;
}

export function validateGraph(input: GraphInput): GraphValidation {
  const scoped = new Set(input.activities.map((a) => a.id));
  const issues: GraphIssue[] = [];

  // Dependency edges (dependent → requirement), intra-scope only, for cycle detection.
  const deps = new Map<string, string[]>();
  for (const a of input.activities) deps.set(a.id, []);

  for (const e of input.edges) {
    if (!scoped.has(e.activityId)) continue;
    for (const r of e.requiresActivityIds) {
      if (scoped.has(r)) {
        deps.get(e.activityId)!.push(r);
      } else if (input.foreignActivityIds.has(r)) {
        issues.push({ kind: "cross_org", activityId: e.activityId, detail: `requires ${r} from another tenant` });
      } else {
        issues.push({ kind: "missing_prerequisite", activityId: e.activityId, detail: `requires unknown activity ${r}` });
      }
    }
  }

  const cyclic = cycleNodes([...scoped], deps);
  for (const n of [...cyclic].sort()) {
    issues.push({ kind: "cycle", activityId: n, detail: "participates in a prerequisite cycle" });
  }

  // Seeds that can never complete: cyclic nodes + nodes with a missing/cross-org requirement.
  const invalidSeed = new Set<string>(cyclic);
  for (const i of issues) if (i.kind === "missing_prerequisite" || i.kind === "cross_org") invalidSeed.add(i.activityId);

  // Forward adjacency (requirement → dependents) to propagate unreachability.
  const dependents = new Map<string, string[]>();
  for (const [dep, reqs] of deps) for (const r of reqs) {
    (dependents.get(r) ?? dependents.set(r, []).get(r)!).push(dep);
  }
  const unreachable = new Set<string>();
  const queue = [...invalidSeed];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const d of dependents.get(cur) ?? []) {
      if (!invalidSeed.has(d) && !unreachable.has(d)) {
        unreachable.add(d);
        queue.push(d);
      }
    }
  }
  for (const n of [...unreachable].sort()) {
    issues.push({ kind: "unreachable", activityId: n, detail: "depends on an unresolvable prerequisite" });
  }

  return { valid: issues.length === 0, issues };
}

// Deterministic topological order (Kahn). Prerequisites precede dependents; ties by id asc.
// Nodes left in cycles are appended at the end, id asc, so the output always lists every node.
export function topoOrder(activities: readonly LearningActivity[], edges: readonly ActivityPrerequisite[]): string[] {
  const prereqs = intraPrereqs({ activities, edges, foreignActivityIds: new Set() });
  const ids = activities.map((a) => a.id);
  const indeg = new Map<string, number>();
  for (const id of ids) indeg.set(id, (prereqs.get(id) ?? []).length);

  const dependents = new Map<string, string[]>();
  for (const id of ids) for (const r of prereqs.get(id) ?? []) {
    (dependents.get(r) ?? dependents.set(r, []).get(r)!).push(id);
  }

  const ready = ids.filter((id) => (indeg.get(id) ?? 0) === 0).sort();
  const out: string[] = [];
  const seen = new Set<string>();
  while (ready.length) {
    ready.sort();
    const n = ready.shift()!;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    for (const d of dependents.get(n) ?? []) {
      indeg.set(d, (indeg.get(d) ?? 0) - 1);
      if ((indeg.get(d) ?? 0) === 0) ready.push(d);
    }
  }
  // Any remaining (cyclic) nodes, id asc.
  for (const id of [...ids].sort()) if (!seen.has(id)) out.push(id);
  return out;
}
