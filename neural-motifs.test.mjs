import assert from "node:assert/strict";
import test from "node:test";
import { neuralStructureFixtures } from "./fixtures/neural-structure-fixtures.mjs";
import { deriveNeuralMotifs, validateNeuralMotifs } from "./neural-motifs.mjs";
import { deriveNeuralSemanticFacts } from "./neural-semantic-facts.mjs";
import { normalizeUniversalIR } from "./universal-ir.mjs";

function motifKinds(fixtureName) {
  const fixture = neuralStructureFixtures.find((item) => item.capability === fixtureName);
  const ir = normalizeUniversalIR({ version: "universal-neural-ir/v1", ...fixture.ir });
  const facts = deriveNeuralSemanticFacts(ir);
  const motifs = deriveNeuralMotifs(ir, facts);
  assert.equal(validateNeuralMotifs(motifs, ir).ok, true, fixtureName);
  return new Set(motifs.motifs.map((motif) => motif.kind));
}

test("derives generic motifs from structure rather than architecture names", () => {
  assert.equal(motifKinds("sampling-repeat").has("repeat-stack"), true);
  assert.equal(motifKinds("bypass-add").has("residual-bypass"), true);
  assert.equal(motifKinds("three-scale-fusion").has("multi-scale-fusion"), true);
  assert.equal(motifKinds("attention").has("attention-region"), true);
  assert.equal(motifKinds("state-feedback").has("state-feedback"), true);
  assert.equal(motifKinds("conditional-routing").has("conditional-route"), true);
  assert.equal(motifKinds("irregular-graph").has("graph-message-passing"), true);
  assert.equal(motifKinds("unknown-operator").has("opaque-module"), true);
});

test("graph-domain inputs stay outside graph message-passing motifs", () => {
  const ir = normalizeUniversalIR({
    version: "universal-neural-ir/v1",
    nodes: [
      { id: "nodes", family: "input", op: "GraphInput", attributes: { dataDomain: "graph" } },
      { id: "gcn", family: "graph", op: "GCNConv", attributes: { dataDomain: "graph" } },
      { id: "output", family: "output", op: "Output" },
    ],
    edges: [
      { id: "e1", source: "nodes", target: "gcn" },
      { id: "e2", source: "gcn", target: "output" },
    ],
  });
  const motifs = deriveNeuralMotifs(ir, deriveNeuralSemanticFacts(ir));
  const graphMotifs = motifs.motifs.filter((motif) => motif.kind === "graph-message-passing");
  assert.deepEqual(graphMotifs.map((motif) => motif.nodeIds), [["gcn"]]);
});

test("motif identities remain stable when model and display labels change", () => {
  const fixture = neuralStructureFixtures.find((item) => item.capability === "bypass-add");
  const originalIR = normalizeUniversalIR({ version: "universal-neural-ir/v1", ...fixture.ir });
  const renamedIR = normalizeUniversalIR({
    ...originalIR,
    source: { ...originalIR.source, name: "Renamed Product" },
    figure: { ...originalIR.figure, title: "Renamed Figure" },
    nodes: originalIR.nodes.map((node) => ({ ...node, label: `Display ${node.id}`, op: `Display${node.id}` })),
  });
  const first = deriveNeuralMotifs(originalIR, deriveNeuralSemanticFacts(originalIR));
  const second = deriveNeuralMotifs(renamedIR, deriveNeuralSemanticFacts(renamedIR));

  assert.deepEqual(first.motifs, second.motifs);
});

test("validation rejects missing motif indexes and dangling index entries", () => {
  const fixture = neuralStructureFixtures.find((item) => item.capability === "bypass-add");
  const ir = normalizeUniversalIR({ version: "universal-neural-ir/v1", ...fixture.ir });
  const motifs = deriveNeuralMotifs(ir, deriveNeuralSemanticFacts(ir));
  const broken = structuredClone(motifs);
  delete broken.nodeToMotifs.input;
  broken.edgeToMotifs.skip.push("motif:missing");

  const validation = validateNeuralMotifs(broken, ir);
  assert.ok(validation.issues.some((issue) => issue.code === "missing-node-motif-index" && issue.nodeId === "input"));
  assert.ok(validation.issues.some((issue) => issue.code === "dangling-motif-index" && issue.edgeId === "skip"));
});
