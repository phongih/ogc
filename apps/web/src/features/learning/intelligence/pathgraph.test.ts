import { describe, expect, it } from "vitest";
import type { ActivityPrerequisite, GraphIssueKind, LearningActivity } from "@ogc/contracts";
import { topoOrder, validateGraph } from "./pathgraph";

const act = (id: string, kind: LearningActivity["kind"] = "reading"): LearningActivity => ({
  id,
  orgId: "O1",
  courseId: "C1",
  lessonId: null,
  title: id,
  kind,
  weight: 1,
  assessed: kind !== "reading",
});
const edge = (activityId: string, ...requiresActivityIds: string[]): ActivityPrerequisite => ({
  activityId,
  orgId: "O1",
  requiresActivityIds,
});
const kinds = (validation: { issues: { kind: GraphIssueKind; activityId: string }[] }) =>
  validation.issues.map((i) => `${i.kind}:${i.activityId}`).sort();

describe("pathgraph — topological order (P1)", () => {
  it("orders prerequisites before dependents, deterministically", () => {
    const acts = [act("C"), act("A"), act("B")];
    const edges = [edge("B", "A"), edge("C", "B")];
    expect(topoOrder(acts, edges)).toEqual(["A", "B", "C"]);
  });

  it("is a stable order for independent nodes (id asc)", () => {
    expect(topoOrder([act("B"), act("A")], [])).toEqual(["A", "B"]);
  });
});

describe("pathgraph — validity (P1)", () => {
  it("a clean acyclic intra-tenant graph is valid", () => {
    const v = validateGraph({
      activities: [act("A"), act("B"), act("C")],
      edges: [edge("B", "A"), edge("C", "B")],
      foreignActivityIds: new Set(),
    });
    expect(v.valid).toBe(true);
    expect(v.issues).toEqual([]);
  });
});

describe("pathgraph — fail-closed integrity (P3, P4)", () => {
  it("detects a 2-node cycle", () => {
    const v = validateGraph({
      activities: [act("A"), act("B")],
      edges: [edge("A", "B"), edge("B", "A")],
      foreignActivityIds: new Set(),
    });
    expect(v.valid).toBe(false);
    expect(kinds(v)).toContain("cycle:A");
    expect(kinds(v)).toContain("cycle:B");
  });

  it("detects a self-loop", () => {
    const v = validateGraph({ activities: [act("A")], edges: [edge("A", "A")], foreignActivityIds: new Set() });
    expect(v.valid).toBe(false);
    expect(kinds(v)).toContain("cycle:A");
  });

  it("flags a missing prerequisite (unknown id)", () => {
    const v = validateGraph({ activities: [act("A")], edges: [edge("A", "Z")], foreignActivityIds: new Set() });
    expect(v.valid).toBe(false);
    expect(kinds(v)).toContain("missing_prerequisite:A");
  });

  it("rejects a cross-org prerequisite reference (P4)", () => {
    const v = validateGraph({
      activities: [act("A")],
      edges: [edge("A", "F")],
      foreignActivityIds: new Set(["F"]),
    });
    expect(v.valid).toBe(false);
    expect(kinds(v)).toContain("cross_org:A");
  });

  it("propagates unreachability to dependents of an unresolvable prerequisite", () => {
    // B requires missing Z; A requires B → A can never become available.
    const v = validateGraph({
      activities: [act("A"), act("B")],
      edges: [edge("B", "Z"), edge("A", "B")],
      foreignActivityIds: new Set(),
    });
    expect(v.valid).toBe(false);
    expect(kinds(v)).toContain("missing_prerequisite:B");
    expect(kinds(v)).toContain("unreachable:A");
  });
});
