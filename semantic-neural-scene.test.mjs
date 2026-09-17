import assert from "node:assert/strict";
import test from "node:test";
import { compileSemanticScene, validateSemanticScene } from "./semantic-neural-scene.mjs";
import { deriveNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { createProjectionMap } from "./neural-projection-map.mjs";
import { normalizeUniversalIR } from "./universal-ir.mjs";

function compile(document, intent = { detail: "balanced" }) {
  const ir = normalizeUniversalIR({ version: "universal-neural-ir/v1", ...document });
  const facts = deriveNeuralSemanticFacts(ir);
  const projectionMap = createProjectionMap(ir, facts, intent);
  return { ir, facts, projectionMap, scene: compileSemanticScene(ir, facts, projectionMap, intent) };
}

test("compiles generic data, operator, merge, state, sequence, repeat, and opaque forms", () => {
  const { scene } = compile({
    nodes: [
      { id: "image", family: "input", shape: { output: [1, 3, 224, 224] } },
      { id: "reduce", family: "pool", shape: { output: [1, 3, 112, 112] } },
      { id: "repeat", family: "conv", repeatCount: 3, shape: { output: [1, 32, 112, 112] } },
      { id: "merge", family: "merge" },
      { id: "state", family: "recurrent" },
      { id: "tokens", family: "attention", shape: { output: [1, 128, 768] } },
      { id: "opaque", family: "custom", compoundKind: "unresolved" },
      { id: "out", family: "output", shape: { output: [1, 10] } },
    ],
    edges: [
      { id: "e1", source: "image", target: "reduce" }, { id: "e2", source: "reduce", target: "repeat" },
      { id: "e3", source: "repeat", target: "merge" }, { id: "e4", source: "image", target: "merge", type: "residual" },
      { id: "e5", source: "merge", target: "state" }, { id: "loop", source: "state", target: "state", type: "state" },
      { id: "e6", source: "state", target: "tokens" }, { id: "e7", source: "tokens", target: "opaque" },
      { id: "e8", source: "opaque", target: "out", type: "output" },
    ],
  });
  const bodyForms = scene.primitives.filter((primitive) => primitive.role === "body").map((primitive) => primitive.form);
  for (const form of ["plane", "wedge", "stack", "glyph", "cell", "strip", "callout", "band"]) assert.ok(bodyForms.includes(form), `missing ${form}`);
  assert.ok(scene.primitives.some((primitive) => primitive.role === "decoration" && primitive.data?.decoration === "repeat"));
  assert.ok(scene.relations.some((relation) => relation.relationTags.includes("bypass")));
  assert.ok(scene.relations.some((relation) => relation.relationTags.includes("state")));
});

test("branch topology emits a split structure without inventing source identities", () => {
  const { scene, ir, projectionMap } = compile({
    nodes: [{ id: "in", family: "input" }, { id: "fork", family: "conv" }, { id: "a", family: "conv" }, { id: "b", family: "conv" }],
    edges: [{ id: "i", source: "in", target: "fork" }, { id: "a", source: "fork", target: "a" }, { id: "b", source: "fork", target: "b" }],
  });
  const split = scene.primitives.find((primitive) => primitive.data?.structure === "split");
  assert.deepEqual(split.sourceNodeIds, ["fork"]);
  assert.equal(validateSemanticScene(scene, ir, projectionMap).ok, true);
});

test("equivalent structural facts choose equivalent primitives after model and module renaming", () => {
  const document = { nodes: [{ id: "in", family: "input", shape: { output: [1, 3, 32, 32] } }, { id: "x", family: "pool", shape: { output: [1, 3, 16, 16] } }], edges: [{ id: "e", source: "in", target: "x" }] };
  const first = compile(document).scene;
  const second = compile({ ...document, figure: { title: "Different Model" }, nodes: document.nodes.map((node) => ({ ...node, label: `Renamed ${node.id}`, op: `Display${node.id}` })) }).scene;
  const signature = (scene) => scene.primitives.map((primitive) => ({ category: primitive.category, form: primitive.form, role: primitive.role, semanticTags: primitive.semanticTags, sourceNodeIds: primitive.sourceNodeIds }));
  assert.deepEqual(signature(first), signature(second));
});

test("validation rejects duplicate bodies and missing projection or source coverage", () => {
  const { scene, ir, projectionMap } = compile({ nodes: [{ id: "a", family: "conv" }], edges: [] });
  scene.primitives.push({ ...scene.primitives.find((primitive) => primitive.role === "body"), id: "duplicate" });
  delete scene.projectionToBody[projectionMap.projections[0].id];
  const validation = validateSemanticScene(scene, ir, projectionMap);
  assert.equal(validation.ok, false);
  assert.ok(validation.issues.some((issue) => issue.code === "duplicate-projection-body"));
  assert.ok(validation.issues.some((issue) => issue.code === "missing-projection-body"));
});

test("validation rejects a source node owned by multiple bodies and dangling scene relations", () => {
  const { scene, ir, projectionMap } = compile({ nodes: [{ id: "a", family: "conv" }, { id: "b", family: "output" }], edges: [{ id: "e", source: "a", target: "b", type: "output" }] });
  const body = scene.primitives.find((primitive) => primitive.role === "body" && primitive.sourceNodeIds.includes("b"));
  body.sourceNodeIds.push("a");
  scene.relations[0].targetPrimitiveId = "missing-body";
  const validation = validateSemanticScene(scene, ir, projectionMap);
  assert.ok(validation.issues.some((issue) => issue.code === "source-node-in-multiple-bodies" && issue.nodeId === "a"));
  assert.ok(validation.issues.some((issue) => issue.code === "dangling-scene-relation" && issue.relationId === "relation:e"));
});

test("projects Universal IR groups to projection body primitive identities", () => {
  const { scene, ir, projectionMap } = compile({
    figure: { title: "A Model Name That Must Not Become A Member" },
    nodes: [{ id: "stem", family: "conv" }, { id: "head", family: "output" }],
    edges: [{ id: "out", source: "stem", target: "head", type: "output" }],
    groups: [{ id: "backbone", label: "Backbone", kind: "stage", nodeIds: ["stem"] }],
  });

  assert.deepEqual(scene.groups, [{
    id: "backbone",
    label: "Backbone",
    role: "stage",
    parentId: "",
    primitiveIds: [scene.projectionToBody[projectionMap.nodeToProjection.stem]],
  }]);
  assert.equal(scene.groups[0].primitiveIds.includes("stem"), false);
  assert.equal(scene.groups[0].primitiveIds.includes(ir.figure.title), false);
  assert.equal(validateSemanticScene(scene, ir, projectionMap).ok, true);
});

test("projects nested containers with descendant body membership and parentId", () => {
  const { scene, ir, projectionMap } = compile({
    nodes: [
      { id: "inside", family: "conv", containerId: "inner" },
      { id: "outside", family: "output", containerId: "outer" },
    ],
    edges: [{ id: "out", source: "inside", target: "outside", type: "output" }],
    containers: [
      { id: "outer", label: "Outer", kind: "module", children: ["inner", "outside"] },
      { id: "inner", label: "Inner", kind: "stage", parentId: "outer", children: ["inside"] },
    ],
  });
  const bodyFor = (nodeId) => scene.projectionToBody[projectionMap.nodeToProjection[nodeId]];

  assert.deepEqual(scene.groups, [
    { id: "outer", label: "Outer", role: "module", parentId: "", primitiveIds: [bodyFor("inside"), bodyFor("outside")] },
    { id: "inner", label: "Inner", role: "stage", parentId: "outer", primitiveIds: [bodyFor("inside")] },
  ]);
  assert.equal(validateSemanticScene(scene, ir, projectionMap).ok, true);
});

test("creates deterministic scene groups from node containerId assignments", () => {
  const { scene, ir, projectionMap } = compile({
    nodes: [
      { id: "a", family: "conv", containerId: "encoder" },
      { id: "b", family: "output", containerId: "head" },
    ],
    edges: [{ id: "ab", source: "a", target: "b", type: "output" }],
  });

  assert.deepEqual(scene.groups, [
    { id: "encoder", label: "encoder", role: "module", parentId: "", primitiveIds: [scene.projectionToBody[projectionMap.nodeToProjection.a]] },
    { id: "head", label: "head", role: "module", parentId: "", primitiveIds: [scene.projectionToBody[projectionMap.nodeToProjection.b]] },
  ]);
  assert.equal(validateSemanticScene(scene, ir, projectionMap).ok, true);
});

test("diagnoses conflicting group ownership when one projection aggregates multiple nodes", () => {
  const { scene, projectionMap } = compile({
    nodes: [{ id: "a", family: "conv" }, { id: "b", family: "norm" }],
    edges: [{ id: "ab", source: "a", target: "b" }],
    groups: [
      { id: "left", nodeIds: ["a"] },
      { id: "right", nodeIds: ["b"] },
    ],
  }, { detail: "overview" });
  const aggregate = projectionMap.projections.find((projection) => projection.orderedNodeIds.length > 1);

  assert.ok(aggregate);
  assert.equal(scene.groups.some((group) => group.primitiveIds.includes(scene.projectionToBody[aggregate.id])), false);
  assert.deepEqual(scene.diagnostics.find((diagnostic) => diagnostic.code === "projection-group-membership-conflict"), {
    code: "projection-group-membership-conflict",
    severity: "error",
    projectionId: aggregate.id,
    nodeIds: ["a", "b"],
    groupIds: ["left", "right"],
  });
});

test("validation rejects dangling group primitive and parent references", () => {
  const { scene, ir, projectionMap } = compile({
    nodes: [{ id: "a", family: "conv", containerId: "child" }],
    edges: [],
    containers: [{ id: "child", parentId: "root", children: ["a"] }, { id: "root", children: ["child"] }],
  });
  scene.primitives.push({ id: "primitive:existing:decoration", role: "decoration" });
  scene.groups.find((group) => group.id === "child").primitiveIds.push("primitive:missing:body");
  scene.groups.find((group) => group.id === "child").primitiveIds.push("primitive:existing:decoration");
  scene.groups.find((group) => group.id === "child").parentId = "missing-parent";

  const validation = validateSemanticScene(scene, ir, projectionMap);
  assert.ok(validation.issues.some((issue) => issue.code === "dangling-group-primitive" && issue.groupId === "child" && issue.primitiveId === "primitive:missing:body"));
  assert.ok(validation.issues.some((issue) => issue.code === "non-body-group-primitive" && issue.groupId === "child"));
  assert.ok(validation.issues.some((issue) => issue.code === "dangling-group-parent" && issue.groupId === "child" && issue.parentId === "missing-parent"));
});

test("relations retain deterministic source and target group context", () => {
  const { scene } = compile({
    nodes: [
      { id: "encoder", family: "conv", containerId: "encoder-group" },
      { id: "decoder", family: "output", containerId: "decoder-group" },
    ],
    edges: [{ id: "skip", source: "encoder", target: "decoder", type: "signal" }],
    containers: [
      { id: "model", children: ["encoder-group", "decoder-group"] },
      { id: "encoder-group", parentId: "model", children: ["encoder"] },
      { id: "decoder-group", parentId: "model", children: ["decoder"] },
    ],
  });

  assert.deepEqual(scene.relations.find((relation) => relation.id === "relation:skip").groupContext, {
    sourceGroupPath: ["model", "encoder-group"],
    targetGroupPath: ["model", "decoder-group"],
    relationScope: "cross-sibling-container",
  });
});
