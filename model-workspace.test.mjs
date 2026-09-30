import assert from "node:assert/strict";
import test from "node:test";
import {
  applyModelWorkspaceOperation,
  createModelWorkspace,
  modelWorkspaceToIR,
  validateModelWorkspace,
  validateModelWorkspaceIRRoundtrip,
} from "./model-workspace.mjs";

function sampleIR() {
  return {
    figure: { title: "Demo", subtitle: "Workspace" },
    nodes: [
      { id: "input", op: "Input", family: "input", label: "Input", shape: { output: [32, 32, 3] } },
      { id: "conv", op: "Conv2d", family: "conv", label: "Conv", shape: { output: [30, 30, 16] } },
      { id: "output", op: "Output", family: "output", label: "Output" },
    ],
    edges: [
      { id: "e1", source: "input", target: "conv", type: "signal" },
      { id: "e2", source: "conv", target: "output", type: "output" },
    ],
    groups: [{ id: "encoder", label: "Encoder", kind: "stage", nodeIds: ["conv"] }],
  };
}

test("creates an editable model workspace from Universal IR", () => {
  const workspace = createModelWorkspace({
    id: "run-1",
    ir: sampleIR(),
    publicationVisioDiagramPlan: {
      nodes: [{ id: "outer::conv", sourceNodeId: "conv", x: 100, y: 200, w: 50, h: 60, shapeKind: "publication-layer-stack" }],
    },
    publicationFigureQa: {
      version: "figure-qa/v1",
      ok: false,
      issues: [{ code: "label-overlaps-node", nodeId: "conv" }],
    },
  });
  assert.equal(workspace.version, "model-workspace/v1");
  assert.equal(workspace.nodes.length, 3);
  assert.deepEqual(workspace.nodes.find((node) => node.id === "conv").groupIds, ["encoder"]);
  assert.deepEqual(workspace.nodes.find((node) => node.id === "conv").ui, { x: 100, y: 200, w: 50, h: 60, shapeKind: "publication-layer-stack" });
  assert.equal(workspace.figureQa.issues[0].nodeId, "conv");
  assert.equal(validateModelWorkspace(workspace).ok, true);
});

test("applies workspace edit operations without mutating the original workspace", () => {
  const workspace = createModelWorkspace({ ir: sampleIR() });
  const renamed = applyModelWorkspaceOperation(workspace, {
    type: "rename-node",
    nodeId: "conv",
    label: "Conv 3x3",
  }).workspace;
  const updated = applyModelWorkspaceOperation(renamed, {
    type: "update-node",
    nodeId: "conv",
    patch: { shape: { output: [28, 28, 16] }, status: "edited" },
  }).workspace;
  const hidden = applyModelWorkspaceOperation(updated, {
    type: "set-node-visibility",
    nodeId: "output",
    visible: false,
  }).workspace;
  const moved = applyModelWorkspaceOperation(hidden, {
    type: "move-node",
    nodeId: "conv",
    ui: { x: 42, y: 84 },
  }).workspace;

  assert.equal(workspace.nodes.find((node) => node.id === "conv").label, "Conv");
  assert.equal(updated.nodes.find((node) => node.id === "conv").label, "Conv 3x3");
  assert.deepEqual(updated.nodes.find((node) => node.id === "conv").shape.output, ["28", "28", "16"]);
  assert.equal(hidden.nodes.find((node) => node.id === "output").visible, false);
  assert.deepEqual(moved.nodes.find((node) => node.id === "conv").ui, { x: 42, y: 84 });
  assert.equal(moved.revision, 5);
});

test("adds and removes workspace edges with endpoint validation", () => {
  const workspace = createModelWorkspace({ ir: sampleIR() });
  const added = applyModelWorkspaceOperation(workspace, {
    type: "add-edge",
    edge: { id: "skip", source: "input", target: "output", type: "skip" },
  }).workspace;
  const removed = applyModelWorkspaceOperation(added, { type: "remove-edge", edgeId: "e1" }).workspace;
  const invalid = applyModelWorkspaceOperation(workspace, {
    type: "add-edge",
    edge: { id: "bad", source: "missing", target: "output" },
  });

  assert.ok(added.edges.some((edge) => edge.id === "skip"));
  assert.equal(removed.edges.some((edge) => edge.id === "e1"), false);
  assert.equal(invalid.diagnostics[0].code, "workspace-edge-endpoint-missing");
});

test("converts an edited workspace back to valid Universal IR", () => {
  const workspace = createModelWorkspace({ ir: sampleIR() });
  const edited = applyModelWorkspaceOperation(workspace, {
    type: "set-node-group",
    nodeId: "input",
    groupId: "encoder",
  }).workspace;
  const roundtrip = validateModelWorkspaceIRRoundtrip(edited);
  const ir = modelWorkspaceToIR(edited);

  assert.equal(roundtrip.ok, true);
  assert.equal(ir.nodes.find((node) => node.id === "input").containerId, "encoder");
  assert.equal(ir.groups.find((group) => group.id === "encoder").nodeIds.includes("input"), true);
});
