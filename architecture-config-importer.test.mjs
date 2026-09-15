import assert from "node:assert/strict";
import test from "node:test";
import { importArchitectureConfig } from "./architecture-config-importer.mjs";

test("imports list modules, repeats, unknown operators, and arbitrary fan-in without name rules", () => {
  const yaml = `
encoder:
  - [-1, 1, SpatialStem, [32, 3]]
  - [-1, 3, MysteryMixer, [64]]
branches:
  - { id: left, from: 1, module: UserBranchA, args: [64] }
  - { id: right, from: 1, module: UserBranchB, args: [64] }
  - { id: join, from: [left, right], module: ArbitraryJoin, args: [] }
`;
  const result = importArchitectureConfig(yaml, { uri: "file:///model.yaml", revision: "abc1234", authority: 4 });
  assert.equal(result.status, "grounded");
  assert.deepEqual(result.graph.nodes.map((node) => node.operator), ["SpatialStem", "MysteryMixer", "UserBranchA", "UserBranchB", "ArbitraryJoin"]);
  assert.equal(result.graph.nodes[1].repeat, 3);
  assert.deepEqual(result.graph.edges.filter((edge) => edge.target === "join").map((edge) => edge.source).sort(), ["left", "right"]);
  assert.ok(result.claims.every((claim) => claim.status === "grounded"));
});

test("follows relative references and preserves parameters without expanding repeats", () => {
  const result = importArchitectureConfig({ pipeline: [
    [-1, 1, "InputAdapter", { channels: 3 }],
    [-1, 4, "RepeatedUnit", { width: 96 }],
    [[-1, 0], 1, "Fusion", { axis: 1 }],
  ] }, { uri: "file:///model.json", revision: "abc1234", authority: 3 });
  assert.deepEqual(result.graph.nodes[1].parameters, { width: 96 });
  assert.equal(result.graph.nodes.length, 3);
  assert.deepEqual(result.graph.edges.filter((edge) => edge.target === "pipeline-2").map((edge) => edge.source).sort(), ["pipeline-0", "pipeline-1"]);
});

test("rejects unsupported configuration text instead of guessing structure", () => {
  const result = importArchitectureConfig("title: metadata only", { uri: "file:///metadata.yaml", revision: "abc1234", authority: 2 });
  assert.equal(result.status, "unresolved");
  assert.ok(result.diagnostics.some((item) => item.code === "no-module-declarations"));
});

test("reports unresolved module references instead of dropping edges", () => {
  const result = importArchitectureConfig({ pipeline: [
    [-1, 1, "Stem", {}],
    ["missing-branch", 1, "Join", {}],
  ] }, { uri: "file:///broken.yaml", revision: "abc1234", authority: 3 });
  assert.equal(result.status, "unresolved");
  assert.ok(result.diagnostics.some((item) => item.code === "unresolved-module-reference" && item.reference === "missing-branch"));
});
