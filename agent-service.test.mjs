import assert from "node:assert/strict";
import test from "node:test";
import {
  applyShapeInference,
  sanitizeIR,
  validateIRSemantics,
  buildSemanticFeedback,
} from "./agent-service.mjs";

// 拆分 server.js 时，这些内部纯函数随 createAgentService 一起移入了
// agent-service.mjs。此前它们只通过 HTTP 边界被间接覆盖，缺少直接断言。
// 本文件补上直接单元测试，避免拆分引入覆盖盲区。

test("applyShapeInference returns the original IR when it has no nodes", () => {
  const ir = { nodes: [], edges: [], figure: { title: "Empty" } };
  assert.strictEqual(applyShapeInference(ir), ir);
  assert.strictEqual(applyShapeInference(undefined), undefined);
});

test("applyShapeInference preserves non-node fields and computes shapes", () => {
  const ir = {
    figure: { title: "Net", subtitle: "shape test" },
    nodes: [
      { id: "in", family: "input", op: "Input", attributes: { inputShape: [56, 56, 64] } },
      { id: "c1", family: "conv", op: "Conv2d", attributes: { constructorArgs: "64, 64, 3, 1, 1" } },
    ],
    edges: [{ source: "in", target: "c1" }],
  };
  const result = applyShapeInference(ir);
  assert.equal(result.figure.title, "Net");
  assert.equal(result.figure.subtitle, "shape test");
  assert.equal(result.nodes.length, 2);
  assert.deepEqual(result.nodes.find((n) => n.id === "c1").shape.output, [56, 56, 64]);
});

test("sanitizeIR bridges across a single meta node and drops it", () => {
  const ir = {
    nodes: [
      { id: "in", op: "Input", family: "input", label: "Input" },
      { id: "hyp", op: "ArchitectureHypothesis", family: "custom", label: "hypothesis" },
      { id: "out", op: "Output", family: "output", label: "Output" },
    ],
    edges: [
      { id: "e1", source: "in", target: "hyp" },
      { id: "e2", source: "hyp", target: "out" },
    ],
  };
  const result = sanitizeIR(ir);
  assert.deepEqual(result.nodes.map((n) => n.id), ["in", "out"]);
  assert.equal(result.edges.length, 1);
  assert.equal(result.edges[0].source, "in");
  assert.equal(result.edges[0].target, "out");
  assert.match(result.edges[0].id, /^bridge-/);
});

test("sanitizeIR drops a leading meta node without inventing a bridge", () => {
  const ir = {
    nodes: [
      { id: "placeholder", op: "Placeholder", family: "custom", label: "placeholder" },
      { id: "c1", op: "Conv2d", family: "conv", label: "Conv" },
    ],
    edges: [{ id: "e1", source: "placeholder", target: "c1" }],
  };
  const result = sanitizeIR(ir);
  assert.deepEqual(result.nodes.map((n) => n.id), ["c1"]);
  assert.equal(result.edges.length, 0);
});

test("sanitizeIR leaves a clean IR untouched", () => {
  const ir = {
    nodes: [{ id: "c1", op: "Conv2d", family: "conv", label: "Conv" }],
    edges: [],
  };
  const result = sanitizeIR(ir);
  assert.deepEqual(result.nodes, ir.nodes);
  assert.deepEqual(result.edges, ir.edges);
});

test("sanitizeIR returns null and empty-graph inputs as-is", () => {
  assert.strictEqual(sanitizeIR(null), null);
  assert.strictEqual(sanitizeIR(undefined), undefined);
  const empty = sanitizeIR({ nodes: [], edges: [] });
  assert.deepEqual(empty.nodes, []);
  assert.deepEqual(empty.edges, []);
});

test("validateIRSemantics reports an empty graph", () => {
  const issues = validateIRSemantics({ nodes: [], edges: [] });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "empty-graph");
});

test("validateIRSemantics accepts a complete grounded graph", () => {
  const ir = {
    nodes: [
      { id: "in", op: "Input", family: "input", label: "Input" },
      { id: "c1", op: "Conv2d", family: "conv", label: "Conv" },
      { id: "out", op: "Output", family: "output", label: "Output" },
    ],
    edges: [
      { id: "e1", source: "in", target: "c1" },
      { id: "e2", source: "c1", target: "out" },
    ],
  };
  assert.deepEqual(validateIRSemantics(ir), []);
});

test("validateIRSemantics flags meta nodes, missing output, and dangling edges", () => {
  const ir = {
    nodes: [
      { id: "in", op: "Input", family: "input", label: "Input" },
      { id: "hyp", op: "Placeholder", family: "custom", label: "assumption" },
    ],
    edges: [{ id: "e1", source: "in", target: "missing" }],
  };
  const kinds = validateIRSemantics(ir).map((i) => i.kind);
  assert.ok(kinds.includes("meta-node"));
  assert.ok(kinds.includes("missing-output"));
  assert.ok(kinds.includes("dangling-edge"));
});

test("validateIRSemantics flags a missing input node", () => {
  const ir = {
    nodes: [{ id: "out", op: "Output", family: "output", label: "Output" }],
    edges: [],
  };
  const kinds = validateIRSemantics(ir).map((i) => i.kind);
  assert.ok(kinds.includes("missing-input"));
  assert.ok(!kinds.includes("missing-output"));
});

test("buildSemanticFeedback returns an empty string when there is nothing to report", () => {
  assert.equal(buildSemanticFeedback([]), "");
  assert.equal(buildSemanticFeedback(null), "");
  assert.equal(buildSemanticFeedback(undefined), "");
});

test("buildSemanticFeedback renders each issue message", () => {
  const feedback = buildSemanticFeedback([
    { kind: "meta-node", message: "Node X is a placeholder, not a concrete layer." },
  ]);
  assert.match(feedback, /Your IR has semantic problems that must be fixed/);
  assert.match(feedback, /- Node X is a placeholder/);
  assert.match(feedback, /Return the corrected full IR JSON/);
});
