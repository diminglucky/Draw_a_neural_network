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
