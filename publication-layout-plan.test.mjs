import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalModelGraph } from "./canonical-model-graph.mjs";
import { createPublicationLayoutPlan, validatePublicationLayoutPlan } from "./publication-layout-plan.mjs";

test("builds publication layout constraints from canonical structure", () => {
  const canonicalModel = buildCanonicalModelGraph({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "input", op: "Input", family: "input", shape: { output: [64, 64, 3] }, containerId: "stage-a" },
      { id: "merge", op: "Add", family: "merge", shape: { output: [64, 64, 64] }, containerId: "stage-a" },
    ],
    edges: [{ id: "skip", source: "input", target: "merge", type: "residual" }],
    containers: [{ id: "stage-a", children: ["input", "merge"], kind: "stage" }],
  });
  const plan = createPublicationLayoutPlan({ canonicalModel, facts: { regionFacts: { "stage-a": {} } }, motifs: { motifs: [] } });
  assert.equal(plan.version, "publication-layout-plan/v1");
  assert.ok(plan.constraints.some((constraint) => constraint.kind === "align-scale-centerlines"));
  assert.ok(plan.constraints.some((constraint) => constraint.kind === "preserve-group" && constraint.groupId === "stage-a"));
  assert.ok(plan.constraints.some((constraint) => constraint.kind === "reserve-route-corridor" && constraint.routeClass === "bypass"));
  assert.equal(validatePublicationLayoutPlan(plan, canonicalModel).ok, true);
});

test("publication layout plan rejects constraints for missing nodes or edges", () => {
  const canonicalModel = buildCanonicalModelGraph({ version: "universal-neural-ir/v1", nodes: [{ id: "n", op: "Input", family: "input" }], edges: [] });
  const invalid = {
    version: "publication-layout-plan/v1",
    direction: "left-to-right",
    constraints: [{ id: "bad", kind: "preserve-group", nodeIds: ["missing"] }, { id: "edge", kind: "reserve-route-corridor", edgeId: "missing" }],
  };
  const validation = validatePublicationLayoutPlan(invalid, canonicalModel);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "layout-constraint-missing-node"));
  assert.ok(validation.issues.some((issue) => issue.code === "layout-constraint-missing-edge"));
});
